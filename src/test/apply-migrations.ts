/**
 * 各テストファイルの実行前に、`migrations/` を D1 に流す。
 * `isolatedStorage` が効いているので、テストごとにここまで巻き戻る。
 */

import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
