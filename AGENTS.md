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

The renderer needs a Rust toolchain with the wasm target:

```
rustup target add wasm32-unknown-unknown
bun run wasm:build               # crates/render -> src/wasm/render.wasm
```

`dev`, `build` and `test` all run `wasm:build` first, so the artifact cannot
go stale. Running the `astro` CLI directly (`astro dev --background`) skips
that, so build it once by hand after a fresh checkout.

`wrangler.jsonc` ships placeholder `database_id` / KV `id` values, which are
fine for local development. Real infrastructure is Terraform's job — see
`infra/README.md`. After `terraform apply`, `bun run infra:sync` writes the
generated IDs back into `wrangler.jsonc`.

Terraform owns only what outlives a deploy (D1, KV, R2). The Worker, its
Durable Objects and every binding stay in `wrangler.jsonc`, since Astro
produces the script and managing it from both sides would drift.

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

## Rendering

`src/lib/render.ts` replays a post's ops onto a canvas. Lines and text stay on
Canvas2D — antialiasing, blend modes and font rasterisation are not worth
reproducing. Displacement is different: it reads pixels back and rewrites them,
so it lives in `src/lib/warp.ts`, which has two interchangeable implementations.

- `crates/render` — Rust compiled to `wasm32-unknown-unknown`. A bare cdylib,
  no wasm-bindgen: everything crossing the boundary is a number or a slice of
  linear memory, so there is nothing for glue code to do. It has no allocator
  either, just `memory.grow` over `__heap_base`.
- `warpJs()` in the same file — the same arithmetic in TypeScript. It runs
  during SSR, in tests, and in the browser until the wasm finishes loading.
  Nothing waits on the wasm; the first frame may be JS and the next wasm.

`warp.test.ts` runs both over the same buffers and demands byte equality. That
is the only thing keeping them honest, so extend it when you touch either side.
Equality is structural rather than lucky: `sin`, `cos` and `pow` are imported
into the wasm from the host's `Math`, so both implementations call the same
functions. That also dropped libm from the binary — 15KB to 4.7KB — and made
`bulge` / `pinch` faster than Rust's own `powf`.

Two things cost more than the arithmetic, and both are handled outside the wasm:

- `getImageData` / `putImageData` per point. Consecutive displacement ops are
  batched into one rectangle, split again when the union grows by more than a
  new rectangle would cost (`BATCH_OVERHEAD_PIXELS`).
- Replaying the whole history every frame. `PostEditor` bakes the image and the
  committed ops into an offscreen canvas and only re-applies pending ops per
  frame, rebuilding that layer when the committed set changes.

Workers and workerd forbid compiling wasm at runtime, so the browser fetches
`render.wasm` as a Vite asset while tests import it as a `WebAssembly.Module`.
Both forms are declared in `src/env.d.ts`.

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
