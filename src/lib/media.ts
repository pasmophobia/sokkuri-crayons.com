/**
 * R2 に置く画像の扱い。
 *
 * 元画像もサムネイルも同一オリジンの `/api/media/*` から配るので、
 * キャンバスが tainted にならず `getImageData`（＝ディスプレイスメント）が効く。
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** アップロードを受け付ける形式と、対応する拡張子。 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

export const ORIGINALS_PREFIX = "originals/";
export const THUMBS_PREFIX = "thumbs/";

/** サムネイルの content-type。クライアントは canvas をこれで書き出す。 */
export const THUMBNAIL_TYPE = "image/webp";
export const THUMBNAIL_MAX_WIDTH = 640;

const ORIGINAL_KEY_RE = /^originals\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/;
const THUMB_KEY_RE = /^thumbs\/[0-9a-f-]{36}$/;

/**
 * `/api/media/*` から読み出してよいキーかどうか。
 * バケット内の任意のオブジェクトを引かせないための番人。
 */
export function isReadableMediaKey(key: string): boolean {
	return ORIGINAL_KEY_RE.test(key) || THUMB_KEY_RE.test(key);
}

/** 元画像のキーとして妥当か（投稿作成時の入力検証用）。 */
export function isOriginalKey(key: string): boolean {
	return ORIGINAL_KEY_RE.test(key);
}

export function originalKey(contentType: string): string | null {
	const extension = ALLOWED_IMAGE_TYPES[contentType];
	return extension ? `${ORIGINALS_PREFIX}${crypto.randomUUID()}.${extension}` : null;
}

export function thumbnailKey(postId: string): string {
	return `${THUMBS_PREFIX}${postId}`;
}

/** ページから画像を参照するときの URL。 */
export function mediaUrl(key: string, version?: number | null): string {
	return version ? `/api/media/${key}?v=${version}` : `/api/media/${key}`;
}
