import { describe, expect, it } from "vitest";

import { normalizeUsername } from "./friends";

describe("normalizeUsername", () => {
	it("保存されている形（@ なし・小文字）に揃える", () => {
		expect(normalizeUsername("@Nakajima")).toBe("nakajima");
		expect(normalizeUsername("  @nakajima  ")).toBe("nakajima");
		expect(normalizeUsername("NAKAJIMA")).toBe("nakajima");
	});

	it("貼り付けで重なった @ をまとめて落とす", () => {
		expect(normalizeUsername("@@nakajima")).toBe("nakajima");
	});

	it("先頭以外の @ は残す（不正な入力として後段で弾かせる）", () => {
		expect(normalizeUsername("naka@jima")).toBe("naka@jima");
	});

	it("空入力は空文字になる", () => {
		expect(normalizeUsername("   ")).toBe("");
		expect(normalizeUsername("@")).toBe("");
	});
});
