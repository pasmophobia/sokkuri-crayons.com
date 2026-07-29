import { describe, expect, it } from "vitest";

import { MAX_IMAGE_EDGE, planUpload } from "./image";
import { MAX_UPLOAD_BYTES } from "./media";

const MB = 1024 * 1024;

describe("planUpload", () => {
	it("収まっている画像は触らない", () => {
		expect(planUpload("image/jpeg", 2 * MB, 1600, 1200)).toBeNull();
		expect(planUpload("image/png", 11_860, 800, 600)).toBeNull();
		expect(planUpload("image/webp", MAX_UPLOAD_BYTES, MAX_IMAGE_EDGE, MAX_IMAGE_EDGE)).toBeNull();
	});

	it("カメラの写真を長辺 MAX_IMAGE_EDGE に詰める", () => {
		expect(planUpload("image/jpeg", 8 * MB, 4000, 3000)).toEqual({
			width: 2048,
			height: 1536,
			type: "image/jpeg",
		});
	});

	it("縦位置でも長辺で測る", () => {
		expect(planUpload("image/jpeg", 8 * MB, 3000, 4000)).toEqual({
			width: 1536,
			height: 2048,
			type: "image/jpeg",
		});
	});

	it("極端に細長い画像でも 1px 以上を残す", () => {
		const plan = planUpload("image/jpeg", MB, 8000, 3);
		expect(plan).toEqual({ width: 2048, height: 1, type: "image/jpeg" });
	});

	it("画素が足りていても重すぎれば詰め直す", () => {
		// 寸法は上限内なので縮めず、jpeg に焼き直して目方だけ落とす。
		expect(planUpload("image/png", MAX_UPLOAD_BYTES + 1, 1200, 900)).toEqual({
			width: 1200,
			height: 900,
			type: "image/jpeg",
		});
	});

	it("受け付けない形式は jpeg に焼き直す", () => {
		// iOS が HEIC のまま寄越しても、ブラウザが解けるなら投稿できる。
		expect(planUpload("image/heic", MB, 1200, 900)).toEqual({
			width: 1200,
			height: 900,
			type: "image/jpeg",
		});
	});

	it("gif は動きを壊さないよう素通しする", () => {
		expect(planUpload("image/gif", MB, 500, 500)).toBeNull();
		expect(planUpload("image/gif", 20 * MB, 4000, 4000)).toBeNull();
	});
});
