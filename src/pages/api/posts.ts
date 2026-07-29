import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { getAgentByName } from "agents";

import type { Post } from "../../agents/post";
import { parseNewPostInput } from "../../agents/post/protocol";
import { insertPost } from "../../lib/posts";

export const prerender = false;

/**
 * 投稿を作る。D1 に索引行を入れ、対応する Post Durable Object に
 * メタ情報を流し込む。クライアントにメタ情報を作らせない。
 */
export const POST: APIRoute = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) {
		return Response.json({ message: "sign in to post" }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ message: "body must be valid json" }, { status: 400 });
	}

	const parsed = parseNewPostInput(body);
	if (!parsed.ok) {
		return Response.json({ message: parsed.reason }, { status: 400 });
	}

	const id = crypto.randomUUID();
	const createdAt = Date.now();

	await insertPost(env.DB, {
		id,
		authorId: user.id,
		imageUrl: parsed.value.imageUrl,
		aspectRatio: parsed.value.aspectRatio,
		caption: parsed.value.caption,
	});

	// キャンバス側にも同じメタ情報を渡しておく。ここで失敗しても投稿自体は
	// 生きているので、詳細ページを開いた時点で改めて初期化される。
	const agent = await getAgentByName<Env, Post>(env.Post, id);
	await agent.initPost({
		imageUrl: parsed.value.imageUrl,
		aspectRatio: parsed.value.aspectRatio,
		caption: parsed.value.caption,
		authorId: user.id,
		createdAt,
	});

	return Response.json({ id }, { status: 201 });
};
