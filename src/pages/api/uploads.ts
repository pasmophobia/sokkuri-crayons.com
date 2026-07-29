import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
	ALLOWED_IMAGE_TYPES,
	AVATAR_TYPE,
	MAX_AVATAR_BYTES,
	MAX_UPLOAD_BYTES,
	avatarKey,
	originalKey,
} from "../../lib/media";

export const prerender = false;

/**
 * 画像を R2 に置く。本文は画像そのもの（生バイト）、形式は content-type で示す。
 * レコードはまだ作らない — 投稿は `POST /api/posts`、アイコンは
 * better-auth の updateUser がそれぞれ受け持つ。
 *
 * `?kind=avatar` はアイコン用。クライアントが正方形に切って縮めた webp を
 * 上げてくるので、形式と上限をそちらに合わせる。
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
	if (!locals.user) {
		return Response.json({ message: "sign in to upload" }, { status: 401 });
	}

	const isAvatar = url.searchParams.get("kind") === "avatar";
	const limit = isAvatar ? MAX_AVATAR_BYTES : MAX_UPLOAD_BYTES;
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";

	if (isAvatar ? contentType !== AVATAR_TYPE : !ALLOWED_IMAGE_TYPES[contentType]) {
		const allowed = isAvatar ? AVATAR_TYPE : Object.keys(ALLOWED_IMAGE_TYPES).join(", ");
		return Response.json({ message: `content-type must be ${allowed}` }, { status: 415 });
	}

	if (Number(request.headers.get("content-length") ?? "0") > limit) {
		return Response.json({ message: "image is too large" }, { status: 413 });
	}

	// content-length は自己申告なので、実体でも上限を確かめる。
	const body = await request.arrayBuffer();
	if (body.byteLength === 0) {
		return Response.json({ message: "image is empty" }, { status: 400 });
	}
	if (body.byteLength > limit) {
		return Response.json({ message: "image is too large" }, { status: 413 });
	}

	const key = isAvatar ? avatarKey() : originalKey(contentType);
	if (!key) {
		return Response.json({ message: "unsupported image type" }, { status: 415 });
	}

	await env.MEDIA.put(key, body, { httpMetadata: { contentType } });

	return Response.json({ key }, { status: 201 });
};
