/**
 * better-auth の設定。ストレージは Cloudflare ネイティブ:
 *   - D1  … user / session / account の永続化
 *   - KV  … secondary storage（セッションキャッシュ・レート制限・検証トークン）
 *
 * ログイン ID はメールアドレス。メール送信の口をまだ持っていないので、
 * 検証は要求しない。
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

/**
 * Cloudflare のバインディングに依存しない設定。
 * ランタイムとスキーマ生成 CLI (`src/auth/cli.ts`) の両方から使うので、
 * ここが一箇所の正になるようにしておく。
 */
export const authOptions = {
	emailAndPassword: {
		enabled: true,
		// メール送信をまだ用意していないため、検証は課さない。
		// 送信できるようになったらここを true にする。
		requireEmailVerification: false,
		minPasswordLength: 8,
		autoSignIn: true,
	},
	rateLimit: {
		enabled: true,
		// KV の TTL 下限が 60 秒なので、window はそれ以上でなければならない。
		window: 60,
		max: 100,
		customRules: {
			// better-auth 既定の window は 60 秒未満で、KV に書けずに落ちる。
			// https://github.com/better-auth/better-auth/issues/5452
			"/sign-in/email": { window: 60, max: 10 },
			"/sign-up/email": { window: 60, max: 5 },
		},
	},
} satisfies BetterAuthOptions;

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(options: {
	env: Env;
	/** `request.cf`。ジオロケーションの付与に使う。 */
	cf?: IncomingRequestCfProperties | null;
	/** リクエストの origin。Workers では `request.url` が実際の接続先を反映する。 */
	baseURL?: string;
}) {
	const { env, cf, baseURL } = options;

	return betterAuth({
		baseURL,
		secret: env.BETTER_AUTH_SECRET,
		...withCloudflare(
			{
				autoDetectIpAddress: true,
				geolocationTracking: true,
				cf: cf ?? {},
				d1Native: env.DB,
				// wrangler が生成する KVNamespace と better-auth-cloudflare が参照する
				// @cloudflare/workers-types の KVNamespace は get のオーバーロードの
				// 並びだけが違う。実体は同じバインディングなので型だけ合わせる。
				kv: env.AUTH_KV as unknown as Parameters<typeof withCloudflare>[0]["kv"],
			},
			authOptions,
		),
	});
}
