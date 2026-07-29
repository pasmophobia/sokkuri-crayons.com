/**
 * R2 に置く元画像の扱い。
 *
 * 同一オリジンの `/api/media/*` から配るので、キャンバスが tainted にならず
 * `getImageData`（＝ディスプレイスメント）が効く。
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** アイコンは正方形に切って縮めてから上げるので、これだけあれば足りる。 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 256;
export const AVATAR_TYPE = "image/webp";

/** アップロードを受け付ける形式と、対応する拡張子。 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

export const ORIGINALS_PREFIX = "originals/";
export const AVATARS_PREFIX = "avatars/";

const ORIGINAL_KEY_RE = /^originals\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/;
const AVATAR_KEY_RE = /^avatars\/[0-9a-f-]{36}\.webp$/;

/**
 * `/api/media/*` から読み出してよいキーかどうか。
 * バケット内の任意のオブジェクトを引かせないための番人。
 */
export function isReadableMediaKey(key: string): boolean {
	return ORIGINAL_KEY_RE.test(key) || AVATAR_KEY_RE.test(key);
}

/** アイコンのキーとして妥当か。`user.image` に入る値の検証に使う。 */
export function isAvatarKey(key: string): boolean {
	return AVATAR_KEY_RE.test(key);
}

export function avatarKey(): string {
	return `${AVATARS_PREFIX}${crypto.randomUUID()}.webp`;
}

/** 元画像のキーとして妥当か（投稿作成時の入力検証用）。 */
export function isOriginalKey(key: string): boolean {
	return ORIGINAL_KEY_RE.test(key);
}

export function originalKey(contentType: string): string | null {
	const extension = ALLOWED_IMAGE_TYPES[contentType];
	return extension ? `${ORIGINALS_PREFIX}${crypto.randomUUID()}.${extension}` : null;
}

/** ページから画像を参照するときの URL。 */
export function mediaUrl(key: string): string {
	return `/api/media/${key}`;
}
