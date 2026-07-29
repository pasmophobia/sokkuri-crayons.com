import { describe, expect, it } from "vitest";

import { LIMITS, parseClientMessage, parseNewPostInput, sanitizeId } from "./protocol";

/** テスト用の最小の stroke payload。 */
function stroke(overrides: Record<string, unknown> = {}) {
	return {
		kind: "stroke",
		points: [{ x: 0.1, y: 0.2 }],
		color: "#ff0066",
		width: 0.01,
		blend: "normal",
		...overrides,
	};
}

function begin(payload: unknown, id = "op-1") {
	return parseClientMessage(JSON.stringify({ type: "op:begin", id, payload }));
}

describe("sanitizeId", () => {
	it("URL セーフな文字列は前後の空白を落として通す", () => {
		expect(sanitizeId("  op_1.a~b-c  ", 64)).toBe("op_1.a~b-c");
	});

	it("空・長すぎ・文字種違反・非文字列を弾く", () => {
		expect(sanitizeId("   ", 64)).toBeNull();
		expect(sanitizeId("a".repeat(65), 64)).toBeNull();
		expect(sanitizeId("op/1", 64)).toBeNull();
		expect(sanitizeId(42, 64)).toBeNull();
	});
});

describe("parseClientMessage", () => {
	it("壊れた JSON と型不明のメッセージを弾く", () => {
		expect(parseClientMessage("{")).toEqual({ ok: false, reason: "message must be valid json" });
		expect(parseClientMessage("[]").ok).toBe(false);
		expect(parseClientMessage(JSON.stringify({ type: "op:teleport" })).ok).toBe(false);
	});

	it("op:begin は payload を検証して通す", () => {
		const result = begin(stroke());
		expect(result).toEqual({
			ok: true,
			value: {
				type: "op:begin",
				id: "op-1",
				payload: {
					kind: "stroke",
					points: [{ x: 0.1, y: 0.2 }],
					color: "#ff0066",
					width: 0.01,
					blend: "normal",
				},
			},
		});
	});

	it("筆圧は 0..1 の範囲でだけ受け取り、省略時は落とす", () => {
		const withPressure = begin(stroke({ points: [{ x: 0, y: 0, p: 0.5 }] }));
		expect(withPressure.ok && withPressure.value).toMatchObject({
			payload: { points: [{ x: 0, y: 0, p: 0.5 }] },
		});

		expect(begin(stroke({ points: [{ x: 0, y: 0, p: 1.5 }] })).ok).toBe(false);
	});

	it("キャンバス外へはみ出す点は許すが、遠すぎる点は弾く", () => {
		expect(begin(stroke({ points: [{ x: -0.5, y: 1.5 }] })).ok).toBe(true);
		expect(begin(stroke({ points: [{ x: -1.1, y: 0 }] })).ok).toBe(false);
		expect(begin(stroke({ points: [{ x: 0, y: Number.NaN }] })).ok).toBe(false);
	});

	it("色は hex 表記のみ受け取る", () => {
		expect(begin(stroke({ color: "#f06" })).ok).toBe(true);
		expect(begin(stroke({ color: "#ff006680" })).ok).toBe(true);
		expect(begin(stroke({ color: "red" })).ok).toBe(false);
		expect(begin(stroke({ color: "#ff00" })).ok).toBe(false);
	});

	it("blend / displace mode は既知の値だけ通す", () => {
		expect(begin(stroke({ blend: "multiply" })).ok).toBe(true);
		expect(begin(stroke({ blend: "hard-light" })).ok).toBe(false);

		const displace = {
			kind: "displace",
			points: [{ x: 0.5, y: 0.5 }],
			radius: 0.1,
			strength: -0.5,
			mode: "swirl",
		};
		expect(begin(displace).ok).toBe(true);
		expect(begin({ ...displace, mode: "melt" }).ok).toBe(false);
		expect(begin({ ...displace, strength: 1.5 }).ok).toBe(false);
	});

	it("text は空文字を弾き、上限文字数までを通す", () => {
		const text = {
			kind: "text",
			at: { x: 0.5, y: 0.5 },
			body: "らくがき",
			size: 0.05,
			color: "#000000",
			rotation: 0,
		};
		expect(begin(text).ok).toBe(true);
		expect(begin({ ...text, body: "   " }).ok).toBe(false);
		expect(begin({ ...text, body: "あ".repeat(LIMITS.MAX_TEXT_LENGTH) }).ok).toBe(true);
		expect(begin({ ...text, body: "あ".repeat(LIMITS.MAX_TEXT_LENGTH + 1) }).ok).toBe(false);
		expect(begin({ ...text, rotation: Math.PI * 3 }).ok).toBe(false);
	});

	it("1 つの op が持てる点の数に上限がある", () => {
		const tooMany = Array.from({ length: LIMITS.MAX_POINTS_PER_OP + 1 }, () => ({ x: 0, y: 0 }));
		expect(begin(stroke({ points: tooMany })).ok).toBe(false);
	});

	it("op:extend は 1 点以上を要求し、1 回あたりの点数を制限する", () => {
		const extend = (points: unknown) =>
			parseClientMessage(JSON.stringify({ type: "op:extend", id: "op-1", points }));

		expect(extend([{ x: 0, y: 0 }]).ok).toBe(true);
		expect(extend([]).ok).toBe(false);
		expect(
			extend(Array.from({ length: LIMITS.MAX_POINTS_PER_EXTEND + 1 }, () => ({ x: 0, y: 0 }))).ok,
		).toBe(false);
	});

	it("op:commit / op:cancel は id を必須にする", () => {
		expect(parseClientMessage(JSON.stringify({ type: "op:commit", id: "op-1" }))).toEqual({
			ok: true,
			value: { type: "op:commit", id: "op-1" },
		});
		expect(parseClientMessage(JSON.stringify({ type: "op:cancel" })).ok).toBe(false);
	});

	it("op:undo は id 省略を許す", () => {
		expect(parseClientMessage(JSON.stringify({ type: "op:undo" }))).toEqual({
			ok: true,
			value: { type: "op:undo" },
		});
		expect(parseClientMessage(JSON.stringify({ type: "op:undo", id: "op/1" })).ok).toBe(false);
	});
});

describe("parseNewPostInput", () => {
	const valid = {
		imageKey: `originals/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.jpg`,
		aspectRatio: 1.5,
		caption: "  ねこ  ",
		visibility: "public",
	};

	it("正しい入力を受け取り、caption を trim する", () => {
		expect(parseNewPostInput(valid)).toEqual({
			ok: true,
			value: {
				imageKey: valid.imageKey,
				aspectRatio: 1.5,
				caption: "ねこ",
				visibility: "public",
			},
		});
	});

	it("アップロード済みの元画像キー以外を弾く", () => {
		expect(parseNewPostInput({ ...valid, imageKey: "avatars/x.webp" }).ok).toBe(false);
		expect(parseNewPostInput({ ...valid, imageKey: "originals/../secret.jpg" }).ok).toBe(false);
	});

	it("visibility を省略したら friends に倒す", () => {
		const { visibility, ...withoutVisibility } = valid;
		void visibility;
		const result = parseNewPostInput(withoutVisibility);
		expect(result.ok && result.value.visibility).toBe("friends");
	});

	it("未知の visibility と長すぎる caption を弾く", () => {
		expect(parseNewPostInput({ ...valid, visibility: "secret" }).ok).toBe(false);
		expect(
			parseNewPostInput({ ...valid, caption: "あ".repeat(LIMITS.MAX_CAPTION_LENGTH + 1) }).ok,
		).toBe(false);
	});

	it("aspectRatio の範囲外を弾く", () => {
		expect(parseNewPostInput({ ...valid, aspectRatio: 0 }).ok).toBe(false);
		expect(parseNewPostInput({ ...valid, aspectRatio: 101 }).ok).toBe(false);
	});
});
