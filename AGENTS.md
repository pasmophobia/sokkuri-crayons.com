## Development

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

`wrangler.jsonc` ships placeholder `database_id` / KV `id` values. They are
fine for local development; replace them with real ones (`wrangler d1 create
artc-auth`, `wrangler kv namespace create AUTH_KV`) before deploying.

## Checks

Four checks gate every pull request. `main` is protected, so all four must be
green before a PR can merge.

```
bun run lint           # ESLint. `bun run lint:fix` to autofix.
bun run typecheck      # astro check — .astro, .ts, and .tsx together.
bun run format:check   # Prettier. `bun run format` to rewrite.
bun run test           # Vitest, once. `bun run test:watch` to iterate.
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

## Auth

Email + password via better-auth, stored in D1 with KV as secondary storage.
Email verification is off — there is no mail transport yet.

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

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
