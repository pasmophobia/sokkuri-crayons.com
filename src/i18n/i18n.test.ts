import { describe, expect, it } from "vitest";

import { LOCALES } from "./config";
import { en } from "./en";
import { ja } from "./ja";
import {
	localePath,
	negotiateLocale,
	splitAroundLink,
	splitLocalePath,
	useTranslations,
} from "./index";

describe("辞書", () => {
	it("すべての言語が同じ鍵を持つ", () => {
		// 型でも縛っているが、`as const` の抜けなどは実行時にしか出ない。
		expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
	});

	it("空の文言が無い", () => {
		for (const locale of LOCALES) {
			const t = useTranslations(locale);
			for (const key of Object.keys(ja) as (keyof typeof ja)[]) {
				expect(t(key), `${locale}:${key}`).not.toBe("");
			}
		}
	});

	it("差し込みの箇所が言語間でずれていない", () => {
		const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
		for (const key of Object.keys(ja) as (keyof typeof ja)[]) {
			expect(placeholders(en[key]), key).toEqual(placeholders(ja[key]));
		}
	});
});

describe("useTranslations", () => {
	it("差し込みを埋める", () => {
		expect(useTranslations("en")("friends.list", { count: 3 })).toBe("Friends (3)");
		expect(useTranslations("ja")("friends.list", { count: 3 })).toBe("フレンド（3）");
	});

	it("渡されなかった差し込みは書式のまま残す", () => {
		expect(useTranslations("en")("newPost.sizeNote", {})).toContain("{mb}");
	});
});

describe("splitAroundLink", () => {
	it("{link} を境に前後へ切る", () => {
		expect(splitAroundLink("No account yet? {link}.")).toEqual(["No account yet? ", "."]);
		expect(splitAroundLink("{link}すると共有されます。")).toEqual(["", "すると共有されます。"]);
	});

	it("{link} が無ければ全部が前になる", () => {
		expect(splitAroundLink("plain")).toEqual(["plain", ""]);
	});
});

describe("localePath / splitLocalePath", () => {
	it("既定のロケールには接頭辞を付けない", () => {
		expect(localePath("ja", "/friends")).toBe("/friends");
		expect(localePath("ja", "/")).toBe("/");
	});

	it("既定以外は接頭辞を付ける", () => {
		expect(localePath("en", "/friends")).toBe("/en/friends");
		expect(localePath("en", "/")).toBe("/en");
	});

	it("往復しても元に戻る", () => {
		for (const path of ["/", "/friends", "/posts/abc", "/posts/new"]) {
			expect(splitLocalePath(localePath("en", path)).path).toBe(path);
			expect(splitLocalePath(localePath("ja", path)).path).toBe(path);
		}
	});

	it("接頭辞が無ければ locale は null", () => {
		expect(splitLocalePath("/friends")).toEqual({ locale: null, path: "/friends" });
	});

	it("`/ja/...` は接頭辞ではなく普通のパスとして扱う", () => {
		// 既定のロケールは接頭辞を持たない。URL を 2 通り作らせない。
		expect(splitLocalePath("/ja/friends")).toEqual({ locale: null, path: "/ja/friends" });
	});

	it("ロケールに見えるだけの語は剥がさない", () => {
		expect(splitLocalePath("/entries")).toEqual({ locale: null, path: "/entries" });
	});
});

describe("negotiateLocale", () => {
	it("q 値の高い順に見る", () => {
		expect(negotiateLocale("ja;q=0.7,en;q=0.9")).toBe("en");
		expect(negotiateLocale("en;q=0.2,ja;q=0.8")).toBe("ja");
	});

	it("q の無いものは 1 として扱い、書かれた順を保つ", () => {
		expect(negotiateLocale("en-US,en;q=0.9,ja;q=0.8")).toBe("en");
	});

	it("地域付きは言語部分で照合する", () => {
		expect(negotiateLocale("en-GB")).toBe("en");
	});

	it("知らない言語しか無ければ null", () => {
		expect(negotiateLocale("fr,de;q=0.8")).toBeNull();
		expect(negotiateLocale("*")).toBeNull();
		expect(negotiateLocale("")).toBeNull();
		expect(negotiateLocale(null)).toBeNull();
	});

	it("q=0 は拒否とみなす", () => {
		expect(negotiateLocale("en;q=0,ja;q=0.5")).toBe("ja");
	});
});
