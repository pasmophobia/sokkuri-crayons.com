/**
 * `Post` Agent の WebSocket プロトコル定義と、受信メッセージの検証。
 *
 * クライアントから来る JSON は一切信用しない。ここを通ったものだけが
 * Agent の状態に触れられる。zod を使わず手書きなのは、`op:extend` が
 * 1 ストロークにつき何十回も飛ぶホットパスだから。
 */

import type {
	BlendMode,
	DisplaceMode,
	OpPayload,
	Point,
	PostMeta,
	PostState,
	SubmittedOp,
	CommittedOp,
} from "./ops";

export const LIMITS = {
	/** 1 つの op が持てる点の総数。 */
	MAX_POINTS_PER_OP: 4096,
	/** 1 回の `op:extend` で追加できる点の数。 */
	MAX_POINTS_PER_EXTEND: 256,
	/** 1 コネクションが同時に持てる未確定 op の数。 */
	MAX_PENDING_OPS_PER_CONNECTION: 4,
	/** 1 投稿が持てる確定済み op の数。超えたら新規 commit を断る。 */
	MAX_COMMITTED_OPS: 2000,
	MAX_OP_ID_LENGTH: 64,
	MAX_TEXT_LENGTH: 140,
	MAX_CAPTION_LENGTH: 280,
	MAX_IMAGE_URL_LENGTH: 2048,
	/** 未確定のまま放置された op を掃除するまでの時間。 */
	PENDING_OP_TTL_MS: 5 * 60 * 1000,
} as const;

// --- クライアント -> サーバ ---

export type ClientMessage =
	| {
			type: "post:create";
			imageUrl: string;
			aspectRatio: number;
			caption: string;
	  }
	/** 新しい op を開始する。この時点から他のクライアントにも見える。 */
	| { type: "op:begin"; id: string; payload: OpPayload }
	/** 進行中の op に点を追加する。 */
	| { type: "op:extend"; id: string; points: Point[] }
	/** 進行中の op を確定させ、履歴に積む。 */
	| { type: "op:commit"; id: string }
	/** 進行中の op を破棄する。 */
	| { type: "op:cancel"; id: string }
	/** 確定済みの op を取り消す。id 省略で自分の最後の op。 */
	| { type: "op:undo"; id?: string };

// --- サーバ -> クライアント ---

export type ServerMessage =
	/**
	 * 接続直後に 1 度だけ。`you` はセッションから引いた自分のユーザー ID で、
	 * 未ログインなら null（閲覧のみ）。
	 */
	| { type: "hello"; you: string | null; displayName: string | null; state: PostState }
	| { type: "post:created"; post: PostMeta }
	| { type: "op:began"; op: SubmittedOp }
	| { type: "op:extended"; id: string; points: Point[] }
	| { type: "op:committed"; op: CommittedOp }
	| { type: "op:cancelled"; id: string }
	| { type: "op:undone"; id: string }
	| { type: "error"; message: string; ref?: string };

export function encode(message: ServerMessage): string {
	return JSON.stringify(message);
}

// --- 検証 ---

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const fail = (reason: string): ParseResult<never> => ({ ok: false, reason });
const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });

const BLEND_MODES: readonly BlendMode[] = ["normal", "multiply", "screen", "overlay"];
const DISPLACE_MODES: readonly DisplaceMode[] = ["smudge", "bulge", "pinch", "swirl"];
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ID_RE = /^[A-Za-z0-9._~-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, min: number, max: number): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
		? value
		: null;
}

/** op / ユーザの ID として安全な文字列かどうか。 */
export function sanitizeId(value: unknown, maxLength: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > maxLength) return null;
	return ID_RE.test(trimmed) ? trimmed : null;
}

function parsePoints(raw: unknown, max: number): ParseResult<Point[]> {
	if (!Array.isArray(raw)) return fail("points must be an array");
	if (raw.length > max) return fail(`points must contain at most ${max} entries`);

	const points: Point[] = [];
	for (const item of raw) {
		if (!isRecord(item)) return fail("each point must be an object");
		// キャンバスの外にはみ出す線は普通にあるので、少し余裕を持たせる。
		const x = num(item.x, -1, 2);
		const y = num(item.y, -1, 2);
		if (x === null || y === null) return fail("point x/y must be a number within -1..2");
		if (item.p === undefined) {
			points.push({ x, y });
			continue;
		}
		const p = num(item.p, 0, 1);
		if (p === null) return fail("point pressure must be a number within 0..1");
		points.push({ x, y, p });
	}
	return ok(points);
}

function parsePoint(raw: unknown): ParseResult<Point> {
	const points = parsePoints([raw], 1);
	if (!points.ok) return points;
	return ok(points.value[0]!);
}

function parseColor(raw: unknown): ParseResult<string> {
	if (typeof raw !== "string" || !COLOR_RE.test(raw)) {
		return fail("color must be a hex string like #rrggbb");
	}
	return ok(raw);
}

function parsePayload(raw: unknown): ParseResult<OpPayload> {
	if (!isRecord(raw)) return fail("payload must be an object");

	switch (raw.kind) {
		case "stroke": {
			const points = parsePoints(raw.points, LIMITS.MAX_POINTS_PER_OP);
			if (!points.ok) return points;
			const color = parseColor(raw.color);
			if (!color.ok) return color;
			const width = num(raw.width, 0.0001, 1);
			if (width === null) return fail("stroke width must be a number within 0..1");
			const blend = BLEND_MODES.find((mode) => mode === raw.blend);
			if (!blend) return fail(`stroke blend must be one of ${BLEND_MODES.join(", ")}`);
			return ok({ kind: "stroke", points: points.value, color: color.value, width, blend });
		}
		case "displace": {
			const points = parsePoints(raw.points, LIMITS.MAX_POINTS_PER_OP);
			if (!points.ok) return points;
			const radius = num(raw.radius, 0.0001, 1);
			if (radius === null) return fail("displace radius must be a number within 0..1");
			const strength = num(raw.strength, -1, 1);
			if (strength === null) return fail("displace strength must be a number within -1..1");
			const mode = DISPLACE_MODES.find((m) => m === raw.mode);
			if (!mode) return fail(`displace mode must be one of ${DISPLACE_MODES.join(", ")}`);
			return ok({ kind: "displace", points: points.value, radius, strength, mode });
		}
		case "text": {
			const at = parsePoint(raw.at);
			if (!at.ok) return at;
			if (typeof raw.body !== "string") return fail("text body must be a string");
			const body = raw.body.trim();
			if (body.length === 0) return fail("text body must not be empty");
			if (body.length > LIMITS.MAX_TEXT_LENGTH) {
				return fail(`text body must be at most ${LIMITS.MAX_TEXT_LENGTH} characters`);
			}
			const size = num(raw.size, 0.0001, 1);
			if (size === null) return fail("text size must be a number within 0..1");
			const color = parseColor(raw.color);
			if (!color.ok) return color;
			const rotation = num(raw.rotation, -Math.PI * 2, Math.PI * 2);
			if (rotation === null) return fail("text rotation must be a number within -2pi..2pi");
			return ok({ kind: "text", at: at.value, body, size, color: color.value, rotation });
		}
		default:
			return fail("payload kind must be one of stroke, displace, text");
	}
}

function parseHttpsUrl(raw: unknown): ParseResult<string> {
	if (typeof raw !== "string" || raw.length > LIMITS.MAX_IMAGE_URL_LENGTH) {
		return fail("imageUrl must be a string url");
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return fail("imageUrl must be a valid url");
	}
	if (url.protocol !== "https:") return fail("imageUrl must use https");
	return ok(url.toString());
}

/** 受信した生フレームを `ClientMessage` に変換する。 */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return fail("message must be valid json");
	}
	if (!isRecord(json)) return fail("message must be a json object");

	switch (json.type) {
		case "post:create": {
			const imageUrl = parseHttpsUrl(json.imageUrl);
			if (!imageUrl.ok) return imageUrl;
			const aspectRatio = num(json.aspectRatio, 0.01, 100);
			if (aspectRatio === null) return fail("aspectRatio must be a number within 0.01..100");
			const caption = typeof json.caption === "string" ? json.caption.trim() : "";
			if (caption.length > LIMITS.MAX_CAPTION_LENGTH) {
				return fail(`caption must be at most ${LIMITS.MAX_CAPTION_LENGTH} characters`);
			}
			return ok({ type: "post:create", imageUrl: imageUrl.value, aspectRatio, caption });
		}
		case "op:begin": {
			const id = sanitizeId(json.id, LIMITS.MAX_OP_ID_LENGTH);
			if (id === null) return fail("op id must be a short url-safe string");
			const payload = parsePayload(json.payload);
			if (!payload.ok) return payload;
			return ok({ type: "op:begin", id, payload: payload.value });
		}
		case "op:extend": {
			const id = sanitizeId(json.id, LIMITS.MAX_OP_ID_LENGTH);
			if (id === null) return fail("op id must be a short url-safe string");
			const points = parsePoints(json.points, LIMITS.MAX_POINTS_PER_EXTEND);
			if (!points.ok) return points;
			if (points.value.length === 0) return fail("op:extend must carry at least one point");
			return ok({ type: "op:extend", id, points: points.value });
		}
		case "op:commit":
		case "op:cancel": {
			const id = sanitizeId(json.id, LIMITS.MAX_OP_ID_LENGTH);
			if (id === null) return fail("op id must be a short url-safe string");
			return ok({ type: json.type, id });
		}
		case "op:undo": {
			if (json.id === undefined) return ok({ type: "op:undo" });
			const id = sanitizeId(json.id, LIMITS.MAX_OP_ID_LENGTH);
			if (id === null) return fail("op id must be a short url-safe string");
			return ok({ type: "op:undo", id });
		}
		default:
			return fail("unknown message type");
	}
}
