## Development

If a React island throws `Invalid hook call` during SSR, restart the dev
server (`astro dev stop`, then start again). Vite re-optimizes dependencies
mid-session, and after that reload the SSR renderer and the components end up
with different React instances. It does not affect `astro build`.

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

### First-time setup

The app does not boot without a local D1 schema and an auth secret:

```
cp .dev.vars.example .dev.vars   # then: openssl rand -base64 32
bun run db:migrate               # applies migrations/ to the local D1
```

`wrangler.jsonc` ships placeholder `database_id` / KV `id` values, which are
fine for local development. Real infrastructure is Terraform's job — see
`infra/README.md`. After `terraform apply`, `bun run infra:sync` writes the
generated IDs back into `wrangler.jsonc`.

Terraform owns only what outlives a deploy (D1, KV, R2). The Worker, its
Durable Objects and every binding stay in `wrangler.jsonc`, since Astro
produces the script and managing it from both sides would drift.

## Checks

Five checks gate every pull request. `main` is protected, so all five must be
green before a PR can merge.

```
bun run lint           # ESLint. `bun run lint:fix` to autofix.
bun run typecheck      # astro check — .astro, .ts, and .tsx together.
bun run format:check   # Prettier. `bun run format` to rewrite.
bun run test           # Vitest, once. `bun run test:watch` to iterate.
bun run test:e2e       # Playwright. `bun run test:e2e:ui` to iterate.
```

ESLint never touches formatting — `eslint-config-prettier` turns those rules off
at the end of `eslint.config.js`. Conflicts between the two are a config bug, not
something to work around per file.

`astro check` fails on errors only; warnings and hints are reported but do not
gate. It generates `.astro/types.d.ts` first, so it works on a clean checkout.

Prettier indents with tabs, including JSON, because `bun add` rewrites
`package.json` with tabs; spaces there would break `format:check` on every
dependency change. YAML and Markdown are the exceptions.

### Tests

Tests run inside workerd via `@cloudflare/vitest-pool-workers`, not Node. So
`env` (from `cloudflare:workers`) hands out the real local D1, and the SQL layer
is tested against actual SQLite rather than a mock. `vitest.config.ts` reads the
bindings straight from `wrangler.jsonc`, and `src/test/apply-migrations.ts`
applies `migrations/` before each test file — schemas cannot drift from the app.

Two things to know before adding tests:

- The entry point is `src/test/worker.ts`, not `src/worker.ts`. The real entry
  imports `@astrojs/cloudflare/handler`, which needs `astro build` output that
  does not exist at test time. The test entry exists to export the `Post`
  Durable Object so its binding resolves.
- Call `resetDb()` from `src/test/seed.ts` in `beforeEach` for anything touching
  D1. Do not lean on `isolatedStorage` to roll writes back; leaving it implicit
  makes tests fail when they get reordered.
- Keep test-only bindings out of `Cloudflare.Env`. Declaring `TEST_MIGRATIONS`
  there makes the real `Env` stop satisfying `Cloudflare.Env`, and every
  `Agent<Env, …>` and `getAgentByName<Env, …>` in the app fails to typecheck.
  `src/test/apply-migrations.ts` casts for it locally instead.

Astro's `getViteConfig()` is unusable here: `@cloudflare/vite-plugin` rejects the
`resolve.external` that Vitest sets on the SSR environment.

### E2E

`bun run test:e2e` drives a real browser (Chromium) against a real build. The
`webServer` in `playwright.config.ts` runs `db:migrate`, `astro build` and
`astro preview`, so what the tests click is the bundle that ships, served by
workerd — with D1, R2, KV, the Durable Object and mail all backed by Miniflare's
local implementations. No Cloudflare account or API token is involved.

`astro dev` is deliberately not used. Vite re-optimizing dependencies mid-session
splits the React instance (see Development above); a built artifact cannot drift
that way. Locally the run reuses whatever already listens on 4321, so keeping
`astro preview` open in another terminal makes the suite start instantly. CI
always starts its own.

Three things the specs lean on:

- Accounts are created per test and never cleaned up. There is no way to roll
  the local D1 back without knocking over whatever runs beside it, so every
  name, username and address carries a random tag instead.
- Each page announces its own `cf-connecting-ip`. better-auth rate-limits
  sign-up to 5 per minute and that header is what keys the bucket, which a
  parallel suite would otherwise trip immediately. Cloudflare overwrites the
  header in production, so the spoof does not travel.
- Wait for `hydrated(page)` before touching a React island. The markup is
  server-rendered, so a button is on screen long before it does anything, and an
  early click on a form submits it the plain way and navigates off the page.
  Astro drops the `ssr` attribute from `<astro-island>` once hydrated — that is
  the signal. The timeline is the exception: its thumbnails are `client:visible`
  and stay unhydrated until scrolled to, so narrow the wait with `within`.

Confirmation links are read out of `.wrangler/tmp/email/` (see Mail below).
`e2e/mail.ts` decodes the token in the link to find out who a message was for,
so simultaneous sign-ups cannot be mixed up.

## Auth

Email + password via better-auth, stored in D1 with KV as secondary storage.
Sign-up sends a confirmation mail and the address has to be confirmed before the
first sign-in. Confirming signs the account in on the spot, so nobody is sent
back to the login form. Where that mail goes is under Mail below.

`src/auth/index.ts` holds the runtime config. `auth.config.ts` at the repo root
exists only for `@better-auth/cli`, which cannot see Cloudflare bindings; it
imports the same `authOptions` so generated SQL cannot drift.

Sign-in is by email. Usernames come from the `username` plugin and exist only
as a unique handle for finding people; they are not credentials.

After changing auth options that affect the schema:

```
bun run auth:generate     # writes auth.schema.sql — a reference, not a migration
```

`auth.schema.sql` is the full CREATE TABLE set as better-auth wants it today.
Diff it against the applied migrations and hand-write the delta as a new
numbered file in `migrations/`, then `bun run db:migrate`. Do not point the
generator at an existing migration: it emits the whole schema, so it will
overwrite an already-applied file rather than describe the change.

## Mail

Verification and password-reset mail goes out through Cloudflare Email Service
via the `EMAIL` (`send_email`) binding. Delivering for real needs Workers Paid
and a domain on Cloudflare DNS onboarded to Email Service; set the sender with
the `MAIL_FROM` var.

Locally, miniflare simulates the binding and writes each message to
`.wrangler/tmp/email/` as `.txt` and `.html`. Nothing is delivered, so pull
verification and reset links out of those files to walk the flows.

The binding deliberately has no `remote: true`. With it, the Vite plugin opens
a session against the real account at startup and the dev server refuses to
boot when credentials are missing or several accounts are available.

Sign-in requires a verified address. Accounts created before verification
existed were marked verified in `0007_grandfather_verified.sql` so they were
not locked out.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
