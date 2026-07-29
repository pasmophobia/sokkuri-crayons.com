import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";

import { createAuth } from "./auth";
import {
	DEFAULT_LOCALE,
	LOCALE_COOKIE,
	isLocale,
	localePath,
	negotiateLocale,
	splitLocalePath,
	type Locale,
} from "./i18n";

/** 切り替えを覚えておく期間。1 年。 */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * 全ページ共通で 1 度だけセッションを引き、`Astro.locals.user` に載せる。
 * 各ページが個別に better-auth を叩かなくて済むようにするため。
 *
 * ロケールもここで決める。`/en/...` は接頭辞を剥がして書き換えるので、
 * ページファイルは 1 セットのままで済む（`src/i18n/index.ts` の冒頭を参照）。
 */
export const onRequest = defineMiddleware(async (context, next) => {
	const { locale, path, redirectTo } = resolveLocale(context.url, context.request.headers);

	// 初回だけ Accept-Language で寄せる。以降は Cookie があるので働かない。
	if (redirectTo) {
		const response = context.redirect(redirectTo + context.url.search, 302);
		rememberLocale(response.headers, locale);
		// 同じ URL でも Accept-Language 次第で行き先が変わることを中間キャッシュに伝える。
		response.headers.append("Vary", "Accept-Language, Cookie");
		return response;
	}

	context.locals.locale = locale;
	context.locals.path = path;

	// better-auth 自身のエンドポイントは自前でセッションを扱うので素通しする
	// （ロケールだけは上で載せてある。確認メールの文面に要る）。
	if (context.url.pathname.startsWith("/api/auth/")) return next();

	try {
		const auth = createAuth({
			env,
			cf: (context.request as Request & { cf?: IncomingRequestCfProperties }).cf,
			baseURL: context.url.origin,
		});
		const session = await auth.api.getSession({ headers: context.request.headers });
		context.locals.user = session
			? {
					id: session.user.id,
					name: session.user.name,
					email: session.user.email,
					image: session.user.image ?? null,
				}
			: null;
	} catch (error) {
		// 認証基盤が落ちても閲覧まで巻き添えにしない。未ログイン扱いで続行する。
		console.error("failed to resolve session", error);
		context.locals.user = null;
	}

	// `/en/friends` を `/friends` として処理する。ページから見た `Astro.url` は
	// 接頭辞の無い形になるので、リンクの組み立てには `Astro.locals.path` を使う。
	const response =
		context.url.pathname === path
			? await next()
			: await next(new URL(path + context.url.search, context.url));

	if (readCookie(context.request.headers, LOCALE_COOKIE) !== locale) {
		rememberLocale(response.headers, locale);
	}
	return response;
});

/**
 * このリクエストのロケールと、接頭辞を除いたパスを決める。
 *
 * 優先順位は URL > Cookie > Accept-Language。URL を最優先にしておかないと、
 * 一度 en を選んだ人が日本語のリンクを踏んでも英語のままになってしまう。
 */
function resolveLocale(
	url: URL,
	headers: Headers,
): { locale: Locale; path: string; redirectTo?: string } {
	const { locale: fromPath, path } = splitLocalePath(url.pathname);
	if (fromPath) return { locale: fromPath, path };

	const cookie = readCookie(headers, LOCALE_COOKIE);

	// API はパスで言語を分けない。返す文面だけ Cookie と Accept-Language で決める。
	if (url.pathname.startsWith("/api/")) {
		const locale = isLocale(cookie)
			? cookie
			: (negotiateLocale(headers.get("accept-language")) ?? DEFAULT_LOCALE);
		return { locale, path };
	}

	// 選んだことがある人の意思が最優先。接頭辞の無い URL は既定のロケール。
	if (isLocale(cookie)) return { locale: DEFAULT_LOCALE, path };

	const preferred = negotiateLocale(headers.get("accept-language"));
	if (preferred && preferred !== DEFAULT_LOCALE) {
		return { locale: preferred, path, redirectTo: localePath(preferred, path) };
	}
	return { locale: DEFAULT_LOCALE, path };
}

function rememberLocale(headers: Headers, locale: Locale): void {
	headers.append(
		"set-cookie",
		`${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`,
	);
}

function readCookie(headers: Headers, name: string): string | null {
	const header = headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return null;
}
