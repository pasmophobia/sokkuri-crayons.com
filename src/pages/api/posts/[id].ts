import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { getAgentByName } from "agents";

import type { Post } from "../../../agents/post";
import { deletePost, getVisiblePost, isImageKeyUnused } from "../../../lib/posts";

export const prerender = false;

/**
 * 投稿を消す。消せるのは投稿者だけ。
 *
 * 後始末は D1 → R2 → Durable Object の順。D1 の行が公開範囲の権威で、
 * これが消えた時点で `src/worker.ts` の関門が新しい接続を 404 で弾く。
 * 続く 2 つが落ちても孤児が残るだけで、投稿は誰にも見えない。
 * 逆順にすると、消したはずの投稿が一瞬でも開ける窓ができてしまう。
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) return Response.json({ message: "sign in first" }, { status: 401 });

	const id = params.id;
	// 見えない投稿は「無い」扱い。存在の有無すら漏らさない。
	const post = id ? await getVisiblePost(env.DB, id, user.id) : null;
	if (!post) return new Response(null, { status: 404 });
	if (post.authorId !== user.id) {
		return Response.json({ message: "自分の投稿だけ削除できます" }, { status: 403 });
	}

	if (!(await deletePost(env.DB, post.id, user.id))) {
		// 取得と削除の間に誰かが先に消した。結果は同じなので 404 で返す。
		return new Response(null, { status: 404 });
	}

	// 同じ画像で 2 度投稿されている場合があるので、参照が絶えたときだけ実体を消す。
	if (await isImageKeyUnused(env.DB, post.imageKey)) {
		await env.MEDIA.delete(post.imageKey);
	}

	// キャンバス側（落書きの履歴）も捨てる。destroy() は isolate を落とすので
	// 呼び出しが例外で終わることがあるが、その時点で既に消えている。
	try {
		const agent = await getAgentByName<Env, Post>(env.Post, post.id);
		await agent.deletePost();
	} catch (error) {
		console.error("failed to destroy post agent", post.id, error);
	}

	return new Response(null, { status: 204 });
};
