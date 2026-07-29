import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { getAgentByName } from "agents";

import type { Post } from "../../../../agents/post";
import { getPost } from "../../../../lib/posts";

export const prerender = false;

/**
 * 投稿の確定済み op を返す。一覧が自前でサムネイルを描くために使う。
 *
 * サーバ側では焼かない（Workers に Canvas が無く、焼く役を誰かに任せると
 * 中身の検証も鮮度の管理もできない）。描けるのはブラウザだけなので、
 * 素材だけ渡して描画は見る側にやらせる。
 */
export const GET: APIRoute = async ({ params }) => {
	const id = params.id;
	if (!id || !(await getPost(env.DB, id))) {
		return new Response(null, { status: 404 });
	}

	const agent = await getAgentByName<Env, Post>(env.Post, id);
	const ops = await agent.listCommittedOps();

	// 落書きはいつ増えるか分からないので溜め込ませない。
	return Response.json({ ops }, { headers: { "cache-control": "no-store" } });
};
