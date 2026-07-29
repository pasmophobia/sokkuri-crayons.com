/**
 * テスト実行時だけ使う Worker エントリ。
 *
 * `wrangler.jsonc` が `Post` の Durable Object を宣言しているので、
 * エントリからその class を export しないとバインディングが解決できない。
 * 本番の `src/worker.ts` はここでは使えない（Astro のビルド生成物に依存する）。
 */

export { Post } from "../agents/post";

export default {
	fetch(): Response {
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
