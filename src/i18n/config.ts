/**
 * ロケールの定義。ここだけは辞書を読み込まない —— middleware も React 島も
 * 辞書本体を持ち込まずに「どの言語か」だけを判断したいことがあるため。
 */

export const LOCALES = ["ja", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** 既定のロケール。URL に接頭辞が付かないのはこれ。 */
export const DEFAULT_LOCALE: Locale = "ja";

/** 切り替えを覚えておく Cookie。自動判定はこれが無いときだけ働く。 */
export const LOCALE_COOKIE = "locale";

/** 言語切り替えに出す名前。その言語の話者に読める形で書く。 */
export const LOCALE_LABELS: Record<Locale, string> = {
	ja: "日本語",
	en: "English",
};

/**
 * `Intl` に渡す BCP 47 タグ。日付の体裁は言語だけでは決まらないので、
 * 地域まで含めたものを持つ。
 */
export const INTL_LOCALES: Record<Locale, string> = {
	ja: "ja-JP",
	en: "en-US",
};

export function isLocale(value: unknown): value is Locale {
	return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
