import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { MAX_UPLOAD_BYTES, THUMBNAIL_TYPE, thumbnailKey } from "../../../../lib/media";
import { getPost, touchThumbnail } from "../../../../lib/posts";

export const prerender = false;

/** 焼き直しの最小間隔。同じ投稿を見ている全員が一斉に上げてくるのを間引く。 */
const MIN_REBAKE_INTERVAL_MS = 30_000;

/**
 * op を焼き込んだ一覧用サムネイルを受け取る。
 *
 * Workers には Canvas が無く、op を再生できるのはブラウザだけなので、
 * 描画済みのクライアントに書き出してもらう形にしている。中身がキャンバスと
 * 一致していることをサーバ側では検証できない。ただしサムネイルは
 * 誰かが投稿を開くたびに焼き直されるので、おかしなものが上がっても
 * 次の閲覧者によって上書きされる。
 */
export const PUT: APIRoute = async ({ params, request, locals }) => {
	if (!locals.user) {
		return Response.json({ message: "sign in to render thumbnails" }, { status: 401 });
	}

	const id = params.id;
	if (!id || !(await getPost(env.DB, id))) {
		return new Response(null, { status: 404 });
	}

	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
	if (contentType !== THUMBNAIL_TYPE) {
		return Response.json({ message: `content-type must be ${THUMBNAIL_TYPE}` }, { status: 415 });
	}

	// 世代の更新に成功した場合だけ焼く。落ちた側は他の誰かが焼いたということ。
	if (!(await touchThumbnail(env.DB, id, MIN_REBAKE_INTERVAL_MS))) {
		return new Response(null, { status: 204 });
	}

	const body = await request.arrayBuffer();
	if (body.byteLength === 0 || body.byteLength > MAX_UPLOAD_BYTES) {
		return Response.json({ message: "invalid thumbnail" }, { status: 400 });
	}

	await env.MEDIA.put(thumbnailKey(id), body, { httpMetadata: { contentType } });

	return new Response(null, { status: 204 });
};
