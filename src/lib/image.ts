/**
 * 投稿に載せる前のブラウザ側の下ごしらえ。
 *
 * 端末のカメラで撮った写真はそのままだと大きすぎる —— 最近の携帯は一枚で
 * 10MB を超えるし、長辺も 4000px 級になる。キャンバスに出す分にはそこまで
 * 要らないので、長辺を詰めて jpeg に焼き直してから上げる。
 *
 * 焼き直しには副産物もある。canvas は EXIF の向きを適用した状態で描くので、
 * 横倒しのまま保管されて後から回転して見える、という事故が起きない。
 */

import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "./media";

/** 長辺の上限。キャンバスに出すには十分で、回線にも優しい大きさ。 */
export const MAX_IMAGE_EDGE = 2048;

/**
 * 元ファイルとして受け取る上限。縮めるにはまずデコードが要るので、
 * 際限なく大きいものを掴むと端末の方が先に落ちる。
 */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

const REENCODE_TYPE = "image/jpeg";
const REENCODE_QUALITY = 0.85;

export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("画像を読み込めませんでした"));
		image.src = src;
	});
}

/** 詰め直したあとの寸法と形式。 */
export type UploadPlan = { width: number; height: number; type: string };

/**
 * この画像をどう詰め直すか決める。そのまま送れるなら null。
 *
 * gif は縮めると動きが一コマになってしまうので、大きくても触らない
 * —— 上限を超えている分は呼び出し側が断る。
 */
export function planUpload(
	type: string,
	bytes: number,
	width: number,
	height: number,
): UploadPlan | null {
	if (type === "image/gif") return null;

	const edge = Math.max(width, height);
	const fits = ALLOWED_IMAGE_TYPES[type] && bytes <= MAX_UPLOAD_BYTES && edge <= MAX_IMAGE_EDGE;
	if (fits) return null;

	// 形式だけが理由（HEIC など）のときは縮めず、jpeg に焼き直すだけにする。
	const scale = Math.min(1, MAX_IMAGE_EDGE / edge);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		type: REENCODE_TYPE,
	};
}

/**
 * アップロードできる形と大きさに整える。
 * すでに収まっているものは触らない（無駄な再圧縮で画質を落とさない）。
 */
export async function fitForUpload(
	file: File,
	image: HTMLImageElement,
): Promise<{ blob: Blob; type: string }> {
	const plan = planUpload(file.type, file.size, image.naturalWidth, image.naturalHeight);
	if (!plan) return { blob: file, type: file.type };

	const canvas = document.createElement("canvas");
	canvas.width = plan.width;
	canvas.height = plan.height;

	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("画像を処理できませんでした");
	ctx.drawImage(image, 0, 0, plan.width, plan.height);

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, plan.type, REENCODE_QUALITY),
	);
	if (!blob) throw new Error("画像を変換できませんでした");
	return { blob, type: plan.type };
}
