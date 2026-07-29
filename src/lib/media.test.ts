import { describe, expect, it } from "vitest";

import {
	ALLOWED_IMAGE_TYPES,
	isAvatarKey,
	isOriginalKey,
	isReadableMediaKey,
	mediaUrl,
	originalKey,
} from "./media";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("メディアキーの検証", () => {
	it("正規の元画像 / アイコンキーを通す", () => {
		expect(isOriginalKey(`originals/${UUID}.jpg`)).toBe(true);
		expect(isAvatarKey(`avatars/${UUID}.webp`)).toBe(true);
		expect(isReadableMediaKey(`originals/${UUID}.png`)).toBe(true);
		expect(isReadableMediaKey(`avatars/${UUID}.webp`)).toBe(true);
	});

	it("バケット内の別オブジェクトを引かせない", () => {
		expect(isReadableMediaKey("secrets/dump.sql")).toBe(false);
		expect(isReadableMediaKey(`originals/../${UUID}.jpg`)).toBe(false);
		expect(isReadableMediaKey(`originals/${UUID}.jpg/../../secret`)).toBe(false);
		expect(isReadableMediaKey(`originals/${UUID}.svg`)).toBe(false);
		expect(isReadableMediaKey("")).toBe(false);
	});

	it("元画像とアイコンの名前空間を混ぜない", () => {
		expect(isAvatarKey(`originals/${UUID}.jpg`)).toBe(false);
		expect(isOriginalKey(`avatars/${UUID}.webp`)).toBe(false);
		expect(isAvatarKey(`avatars/${UUID}.jpg`)).toBe(false);
	});
});

describe("originalKey", () => {
	it("許可された content-type だけキーを発行する", () => {
		for (const [type, extension] of Object.entries(ALLOWED_IMAGE_TYPES)) {
			const key = originalKey(type);
			expect(key, type).not.toBeNull();
			expect(key!.endsWith(`.${extension}`)).toBe(true);
			expect(isOriginalKey(key!)).toBe(true);
		}
	});

	it("許可されていない形式には null を返す", () => {
		expect(originalKey("image/svg+xml")).toBeNull();
		expect(originalKey("application/pdf")).toBeNull();
		expect(originalKey("")).toBeNull();
	});

	it("呼ぶたびに違うキーになる", () => {
		expect(originalKey("image/png")).not.toBe(originalKey("image/png"));
	});
});

describe("mediaUrl", () => {
	it("同一オリジンの API 配下を指す", () => {
		expect(mediaUrl(`originals/${UUID}.jpg`)).toBe(`/api/media/originals/${UUID}.jpg`);
	});
});
