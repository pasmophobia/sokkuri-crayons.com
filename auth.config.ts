/**
 * `@better-auth/cli generate` 専用の設定。アプリのバンドルには含まれない。
 *
 * CLI は D1 バインディングを持てないので、方言だけ揃えたインメモリ SQLite を差す。
 * ランタイムと同じ `authOptions` / `withCloudflare` を通しているので、
 * cloudflare プラグインが session テーブルに足すジオロケーション列も
 * ちゃんと生成 SQL に出る。
 *
 *   bun run auth:generate
 */

import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

import { authOptions } from "./src/auth";

export const auth = betterAuth({
	...withCloudflare(
		{
			autoDetectIpAddress: true,
			geolocationTracking: true,
			cf: {},
			d1Native: undefined,
		},
		authOptions,
	),
	database: new DatabaseSync(":memory:"),
});
