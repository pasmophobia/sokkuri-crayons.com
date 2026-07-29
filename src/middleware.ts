import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";

import { createAuth } from "./auth";

/**
 * 全ページ共通で 1 度だけセッションを引き、`Astro.locals.user` に載せる。
 * 各ページが個別に better-auth を叩かなくて済むようにするため。
 */
export const onRequest = defineMiddleware(async (context, next) => {
	// better-auth 自身のエンドポイントは自前でセッションを扱うので素通しする。
	if (context.url.pathname.startsWith("/api/auth/")) return next();

	try {
		const auth = createAuth({
			env,
			cf: (context.request as Request & { cf?: IncomingRequestCfProperties }).cf,
			baseURL: context.url.origin,
		});
		const session = await auth.api.getSession({ headers: context.request.headers });
		context.locals.user = session
			? { id: session.user.id, name: session.user.name, email: session.user.email }
			: null;
	} catch (error) {
		// 認証基盤が落ちても閲覧まで巻き添えにしない。未ログイン扱いで続行する。
		console.error("failed to resolve session", error);
		context.locals.user = null;
	}

	return next();
});
