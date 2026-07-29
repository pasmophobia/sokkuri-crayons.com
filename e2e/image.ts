/**
 * 投稿に上げる写真をその場で作る。
 *
 * バイナリを 1 枚リポジトリに置いてもよいが、差分が読めないものを版管理に
 * 混ぜたくない。PNG は自前で組み立てても数十行で済む。
 *
 * 640x480 にしてあるのは、縦横比が 1 でない方が良いため —— 1 だと
 * アスペクト比の取り違えがテストをすり抜ける。長辺は MAX_IMAGE_EDGE より
 * 小さいので、ブラウザ側で jpeg に焼き直されず png のまま上がる
 * （`src/lib/image.ts` の planUpload）。
 */

import { deflateSync } from "node:zlib";

export const PHOTO_WIDTH = 640;
export const PHOTO_HEIGHT = 480;
export const PHOTO_ASPECT_RATIO = PHOTO_WIDTH / PHOTO_HEIGHT;
export const PHOTO_TYPE = "image/png";

/** アップロード用の PNG。中身は位置で色が変わるグラデーション。 */
export function photo(width = PHOTO_WIDTH, height = PHOTO_HEIGHT): Buffer {
	// 各行の先頭にフィルタ種別（0 = なし）を置き、あとは RGB を並べる。
	const raw = Buffer.alloc(height * (1 + width * 3));
	let at = 0;

	for (let y = 0; y < height; y += 1) {
		raw[at++] = 0;
		for (let x = 0; x < width; x += 1) {
			raw[at++] = Math.round((x / width) * 255);
			raw[at++] = Math.round((y / height) * 255);
			raw[at++] = 0x66;
		}
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // ビット深度
	header[9] = 2; // トゥルーカラー（RGB）

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);

	// CRC は種別と中身の両方にかかる。
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));

	return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Buffer): number {
	let crc = ~0;

	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}

	return ~crc >>> 0;
}
