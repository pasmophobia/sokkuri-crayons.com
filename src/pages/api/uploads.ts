import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, originalKey } from "../../lib/media";

export const prerender = false;

/**
 * 元画像を R2 に置く。本文は画像そのもの（生バイト）、形式は content-type で示す。
 * 投稿レコードはまだ作らない — 作成は `POST /api/posts` が受ける。
 */
export const POST: APIRoute = async ({ request, locals }) => {
	if (!locals.user) {
		return Response.json({ message: "sign in to upload" }, { status: 401 });
	}

	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
	if (!ALLOWED_IMAGE_TYPES[contentType]) {
		return Response.json(
			{ message: `content-type must be one of ${Object.keys(ALLOWED_IMAGE_TYPES).join(", ")}` },
			{ status: 415 },
		);
	}

	const declaredLength = Number(request.headers.get("content-length") ?? "0");
	if (declaredLength > MAX_UPLOAD_BYTES) {
		return Response.json({ message: "image is too large" }, { status: 413 });
	}

	// content-length は自己申告なので、実体でも上限を確かめる。
	const body = await request.arrayBuffer();
	if (body.byteLength === 0) {
		return Response.json({ message: "image is empty" }, { status: 400 });
	}
	if (body.byteLength > MAX_UPLOAD_BYTES) {
		return Response.json({ message: "image is too large" }, { status: 413 });
	}

	const key = originalKey(contentType);
	if (!key) {
		return Response.json({ message: "unsupported image type" }, { status: 415 });
	}

	await env.MEDIA.put(key, body, { httpMetadata: { contentType } });

	return Response.json({ key }, { status: 201 });
};
