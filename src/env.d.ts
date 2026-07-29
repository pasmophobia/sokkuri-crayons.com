/**
 * wasm の読み込み方は環境で違う。ブラウザ向けには Vite に URL を吐かせて実行時に
 * fetch する。workerd は実行時のコンパイルを許さないので、テストだけは
 * バンドラに `WebAssembly.Module` として解決させる。
 */
declare module "*.wasm?url" {
	const url: string;
	export default url;
}

declare module "*.wasm" {
	const module: WebAssembly.Module;
	export default module;
}

type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
	interface Locals extends Runtime {
		/** middleware が載せる。未ログインなら null。 */
		user: { id: string; name: string; email: string; image: string | null } | null;
	}
}
