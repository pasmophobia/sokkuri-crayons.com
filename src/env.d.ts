type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
	interface Locals extends Runtime {
		/** middleware が載せる。未ログインなら null。 */
		user: { id: string; name: string; email: string } | null;
	}
}
