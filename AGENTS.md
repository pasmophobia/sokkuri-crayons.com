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
