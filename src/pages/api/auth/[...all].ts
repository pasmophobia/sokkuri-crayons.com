import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { createAuth } from "../../../auth";

export const prerender = false;

/** better-auth のエンドポイント一式 (`/api/auth/*`) をそのまま流す。 */
export const ALL: APIRoute = ({ request }) => {
	const auth = createAuth({
		env,
		// Workers では request.cf にエッジのジオ情報が乗る。
		cf: (request as Request & { cf?: IncomingRequestCfProperties }).cf,
		baseURL: new URL(request.url).origin,
	});
	return auth.handler(request);
};
