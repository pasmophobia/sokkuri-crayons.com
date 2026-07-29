/**
 * better-auth の設定。ストレージは Cloudflare ネイティブ:
 *   - D1  … user / session / account の永続化
 *   - KV  … secondary storage（セッションキャッシュ・レート制限・検証トークン）
 *
 * ログイン ID はメールアドレス。確認メールとパスワード再設定は Cloudflare
 * Email Service（`EMAIL` バインディング）から送る。
 *
 * ユーザー名 (username プラグイン) はログインには使わず、フレンド検索と表示の
 * ための一意な handle として持つ。
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { sendMail, template } from "../lib/mailer";
import { username } from "better-auth/plugins";
import { withCloudflare } from "better-auth-cloudflare";

/**
 * Cloudflare のバインディングに依存しない設定。
 * ランタイムとスキーマ生成 CLI (`src/auth/cli.ts`) の両方から使うので、
 * ここが一箇所の正になるようにしておく。
 */
export const authOptions = {
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		minPasswordLength: 8,
		autoSignIn: true,
	},
	emailVerification: {
		sendOnSignUp: true,
		// 確認できた時点でそのまま入れるようにする。もう一度ログインさせる必要がない。
		autoSignInAfterVerification: true,
		expiresIn: 60 * 60 * 24,
	},
	user: {
		changeEmail: {
			enabled: true,
			// 未検証のうちは確認を挟まず差し替える。検証済みの利用者は
			// better-auth が自動的に新アドレスへの確認メール経由に切り替える。
			updateEmailWithoutVerification: true,
		},
	},
	plugins: [
		// ログイン ID はメールのまま。ユーザー名は人を探すための一意な handle。
		username({
			minUsernameLength: 3,
			maxUsernameLength: 20,
			// 既定は英数字と下線のみ。大小の違いで別人になると探しづらいので、
			// 正規化（小文字化）は既定のまま使い、表示用は入力どおり残す。
		}),
	],
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
			{
				...authOptions,
				// 送信には env が要るので、共有の authOptions ではなくここで足す
				// （authOptions はスキーマ生成 CLI とも共有していて env を持てない）。
				emailVerification: {
					...authOptions.emailVerification,
					sendVerificationEmail: async ({ user, url }) => {
						await sendMail(env, {
							to: user.email,
							subject: "メールアドレスの確認 | そっくりクレヨン",
							...template({
								heading: "メールアドレスを確認してください",
								body: "そっくりクレヨンのアカウントを有効にするには、下のボタンを押してください。",
								actionLabel: "確認する",
								url,
								note: "このリンクは 24 時間で切れます。心当たりがなければ、このメールは無視してください。",
							}),
						});
					},
				},
				emailAndPassword: {
					...authOptions.emailAndPassword,
					sendResetPassword: async ({ user, url }) => {
						await sendMail(env, {
							to: user.email,
							subject: "パスワードの再設定 | そっくりクレヨン",
							...template({
								heading: "パスワードを再設定します",
								body: "下のボタンから新しいパスワードを設定してください。",
								actionLabel: "再設定する",
								url,
								note: "心当たりがなければ、このメールは無視してください。パスワードは変わりません。",
							}),
						});
					},
				},
			},
		),
	});
}
