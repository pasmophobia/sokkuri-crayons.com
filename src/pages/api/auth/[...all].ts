import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { createAuth } from "../../../auth";

export const prerender = false;

/** better-auth のエンドポイント一式 (`/api/auth/*`) をそのまま流す。 */
export const ALL: APIRoute = ({ request, locals }) => {
	const auth = createAuth({
		env,
		// Workers では request.cf にエッジのジオ情報が乗る。
		cf: (request as Request & { cf?: IncomingRequestCfProperties }).cf,
		baseURL: new URL(request.url).origin,
		// 確認・再設定メールはここから送られる。文面は今のロケールで。
		locale: locals.locale,
	});
	return auth.handler(request);
};
