/**
 * E2E は本番と同じ形 —— `astro build` の出力を workerd（wrangler dev）で
 * 動かしたもの —— に対して回す。`astro dev` ではないのは、Vite の依存最適化が
 * 途中で走ると React のインスタンスが割れることがあるため（CLAUDE.md）。
 * ビルド済みの成果物ならその揺れが無い。
 *
 * D1・R2・KV・Durable Object・メール送信はすべて miniflare のローカル実装が
 * 受ける。Cloudflare のアカウントも API トークンも要らない。
 *
 * ブラウザは Chromium だけ。落書きは canvas の getImageData まで使うので、
 * 複数のエンジンに広げると得るものより揺れの方が大きい。
 */

import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, PORT } from "./e2e/config";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	// CI に .only が紛れ込んだら、通ったことにせず落とす。
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: [["list"], ["html", { open: "never" }]],

	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
	},

	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

	webServer: {
		// スキーマが古いと起動はするのに何も動かないので、先に流しておく。
		command: `bun run db:migrate && bun run build && bun run astro preview --port ${PORT}`,
		url: BASE_URL,
		// 手元では立ち上げっぱなしのサーバに相乗りする。CI では必ず自分で起こす。
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
