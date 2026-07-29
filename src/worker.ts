import { handle } from "@astrojs/cloudflare/handler";
import { routeAgentRequest } from "agents";

import { createAuth } from "./auth";
import { getVisiblePost } from "./lib/posts";

export { Post } from "./agents/post";

const POST_AGENT_PATH = /^\/agents\/post\/([^/?]+)/;

export default {
	async fetch(request, env, ctx) {
		// フレンド限定の投稿は、WebSocket を張らせる前に弾く。
		//
		// Durable Object の中で判断したのでは間に合わない。Agents SDK は接続時に
		// `cf_agent_state` を自動で送るので、`onConnect` の非同期チェックが
		// 終わるころには state（画像キー・キャプション・op 一式）が相手に渡っている。
		const match = POST_AGENT_PATH.exec(new URL(request.url).pathname);
		if (match && !(await mayViewPost(request, env, decodeURIComponent(match[1]!)))) {
			// 見えない投稿は「無い」扱い。存在の有無すら漏らさない。
			return new Response(null, { status: 404 });
		}

		// `/agents/post/:postId` は Post Agent に、それ以外は Astro に流す。
		return (await routeAgentRequest(request, env)) ?? handle(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

async function mayViewPost(request: Request, env: Env, postId: string): Promise<boolean> {
	try {
		const auth = createAuth({ env, baseURL: new URL(request.url).origin });
		const session = await auth.api.getSession({ headers: request.headers });
		return (await getVisiblePost(env.DB, postId, session?.user.id ?? null)) !== null;
	} catch (error) {
		// 判断できないときは閉じる方に倒す。開いてしまうより安全。
		console.error("failed to authorize post socket", error);
		return false;
	}
}
