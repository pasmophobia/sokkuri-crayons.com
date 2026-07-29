import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { isReadableMediaKey, THUMBS_PREFIX } from "../../../lib/media";

export const prerender = false;

/**
 * R2 の画像を同一オリジンから配る。
 * 同一オリジンなのでキャンバスが tainted にならず、`getImageData` が使える。
 */
export const GET: APIRoute = async ({ params, request }) => {
	const key = params.key ?? "";
	// バケット内の任意のオブジェクトを引かせない。
	if (!isReadableMediaKey(key)) {
		return new Response(null, { status: 404 });
	}

	const object = await env.MEDIA.get(key, {
		onlyIf: request.headers.get("if-none-match")
			? { etagDoesNotMatch: request.headers.get("if-none-match")! }
			: undefined,
	});
	if (!object) return new Response(null, { status: 404 });

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	// 元画像は不変。サムネイルは焼き直されるので、URL の ?v= で世代を切り替える。
	headers.set(
		"cache-control",
		key.startsWith(THUMBS_PREFIX) ? "public, max-age=60" : "public, max-age=31536000, immutable",
	);

	// onlyIf が効いた場合は body を持たない = 中身は変わっていない。
	if (!("body" in object) || object.body === null) {
		return new Response(null, { status: 304, headers });
	}

	return new Response(object.body, { headers });
};
