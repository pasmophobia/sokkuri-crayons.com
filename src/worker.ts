import { handle } from "@astrojs/cloudflare/handler";
import { routeAgentRequest } from "agents";

export { Post } from "./agents/post";

export default {
	async fetch(request, env, ctx) {
		// `/agents/post/:postId` は Post Agent に、それ以外は Astro に流す。
		return (await routeAgentRequest(request, env)) ?? handle(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
