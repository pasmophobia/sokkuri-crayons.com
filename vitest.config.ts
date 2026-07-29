/**
 * テストは Cloudflare 公式の `@cloudflare/vitest-pool-workers` で走らせる。
 * Node ではなく workerd の中で実行されるので、`cloudflare:workers` の `env` から
 * D1 の本物のローカル実装に触れる。SQL 層はモックせずそのまま試せる。
 *
 * Astro の `getViteConfig()` は使わない。`@cloudflare/vite-plugin` が Vitest の
 * SSR 環境設定と衝突して起動できないため。バインディングは `wrangler.jsonc` を
 * そのまま読ませているので、設定が二重にならない。
 *
 * ただしエントリだけは差し替える。本番の `src/worker.ts` は
 * `@astrojs/cloudflare/handler` を通じて `astro build` の生成物に依存していて、
 * ビルド前には解決できない。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			main: "./src/test/worker.ts",
			// テストごとに D1 の中身を巻き戻す。
			isolatedStorage: true,
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				// migrations/ をそのまま読み、各テストファイルの前に流し込む。
				// スキーマを手で書き直さないので、本番の D1 と乖離しない。
				bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(root, "migrations")) },
			},
		})),
	],
	test: {
		include: ["src/**/*.test.ts"],
		setupFiles: ["./src/test/apply-migrations.ts"],
	},
});
