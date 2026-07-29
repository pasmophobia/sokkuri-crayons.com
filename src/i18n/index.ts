/**
 * 文言の引き当てと、ロケール付き URL の組み立て。
 *
 * Astro 組み込みの i18n ルーティングは使っていない。あれは既定以外のロケール
 * ぶんだけページファイルを別に置くことを前提にしていて、この規模だと
 * `src/pages/` を丸ごと二重に持つことになる。代わりに middleware で
 * `/en/...` を剥がして書き換え、ページは 1 セットのままにしてある
 * （`src/middleware.ts`）。
 */

import { DEFAULT_LOCALE, INTL_LOCALES, LOCALES, isLocale, type Locale } from "./config";
import { en } from "./en";
import { ja, type MessageKey, type Messages } from "./ja";

export type { Locale } from "./config";
export type { MessageKey } from "./ja";
export {
	DEFAULT_LOCALE,
	LOCALES,
	LOCALE_COOKIE,
	LOCALE_LABELS,
	INTL_LOCALES,
	isLocale,
} from "./config";

const DICTIONARIES: Record<Locale, Messages> = { ja, en };

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * そのロケールの `t()` を返す。
 *
 * 差し込みは `{name}`。渡されなかった差し込みは書式のまま残す —— 消すと
 * 「なぜか文が欠けている」に化けるので、見えて困る方に倒す。
 */
export function useTranslations(locale: Locale): Translate {
	const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];

	return (key, params) => {
		const message = dictionary[key];
		if (params === undefined) return message;
		return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
			name in params ? String(params[name]) : whole,
		);
	};
}

/**
 * リンクを挟む文を前後に切り分ける。`{link}` を境にした 2 つを返す。
 *
 * 「{link}すると共有されます」のような文は、語順が言語で変わるので
 * JSX 側で前後を組み立てるわけにいかない。文は辞書に 1 本で持ち、
 * 切る位置だけをここで決める。
 */
export function splitAroundLink(message: string): [before: string, after: string] {
	const at = message.indexOf("{link}");
	if (at === -1) return [message, ""];
	return [message.slice(0, at), message.slice(at + "{link}".length)];
}

/** そのロケールでのパス。既定のロケールは接頭辞を付けない。 */
export function localePath(locale: Locale, path: string): string {
	const normalized = path.startsWith("/") ? path : `/${path}`;
	if (locale === DEFAULT_LOCALE) return normalized;
	return normalized === "/" ? `/${locale}` : `/${locale}${normalized}`;
}

/**
 * パスの先頭に付いたロケールを剥がす。
 * 付いていなければ `locale` は null（既定のロケールと、判定の余地がある場合を
 * 呼び出し側で区別できるようにするため）。
 */
export function splitLocalePath(pathname: string): { locale: Locale | null; path: string } {
	const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
	const head = match?.[1];

	// 既定のロケールは接頭辞を持たないので、`/ja/...` は普通のパスとして扱う。
	if (!head || !isLocale(head) || head === DEFAULT_LOCALE) return { locale: null, path: pathname };
	return { locale: head, path: match[2] ?? "/" };
}

/**
 * `Accept-Language` から一番近いロケールを選ぶ。決められなければ null。
 * `en-GB` のような地域付きは言語部分で照合する。
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
	if (!acceptLanguage) return null;

	const ranked = acceptLanguage
		.split(",")
		.map((part) => {
			const [tag, ...parameters] = part.trim().split(";");
			const quality = parameters.reduce((current, parameter) => {
				const matched = /^\s*q=([\d.]+)\s*$/.exec(parameter);
				return matched ? Number(matched[1]) : current;
			}, 1);
			return { tag: tag.trim().toLowerCase(), quality };
		})
		.filter((entry) => entry.tag !== "" && Number.isFinite(entry.quality) && entry.quality > 0)
		// 同じ q のものは書かれた順を保ちたいので、安定ソートに任せる。
		.sort((a, b) => b.quality - a.quality);

	for (const { tag } of ranked) {
		const language = tag.split("-")[0];
		const found = LOCALES.find((candidate) => candidate === language);
		if (found) return found;
	}
	return null;
}

/** そのロケールでの日付書式。 */
export function dateFormatter(
	locale: Locale,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat(INTL_LOCALES[locale], options);
}
