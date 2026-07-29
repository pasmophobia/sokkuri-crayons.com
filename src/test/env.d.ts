/// <reference types="@cloudflare/vitest-pool-workers/types" />

// `cloudflare:test` の型だけを読み込む。テスト専用のバインディング
// (`TEST_MIGRATIONS`) をここで `Cloudflare.Env` に足してはいけない。足すと本番の
// `Env` が `Cloudflare.Env` を満たさなくなり、`Agent<Env, …>` が型エラーになる。
// 受け取りは `src/test/apply-migrations.ts` の中に閉じ込めてある。
