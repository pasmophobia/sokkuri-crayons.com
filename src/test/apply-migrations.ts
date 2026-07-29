/**
 * 各テストファイルの実行前に、`migrations/` を D1 に流す。
 * `isolatedStorage` が効いているので、テストごとにここまで巻き戻る。
 */

import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// `vitest.config.ts` が注入するテスト専用のバインディング。`Cloudflare.Env` に
// 宣言してしまうと本番の `Env` 型まで巻き込むので、ここで受け取る。
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(env.DB, TEST_MIGRATIONS);
