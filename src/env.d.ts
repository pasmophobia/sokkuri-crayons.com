type Runtime = import("@astrojs/cloudflare").Runtime;
type Locale = import("./i18n/config").Locale;

declare namespace App {
	interface Locals extends Runtime {
		/** middleware が載せる。未ログインなら null。 */
		user: { id: string; name: string; email: string; image: string | null } | null;
		/** このリクエストのロケール。middleware が決める。 */
		locale: Locale;
		/**
		 * ロケール接頭辞を除いたパス。`/en/friends` なら `/friends`。
		 * 書き換え後の `Astro.url` と同じ形なので、リンクの組み立てに使う。
		 */
		path: string;
	}
}
