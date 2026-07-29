/**
 * 投稿ページの描画エンジン。
 *
 * 接続そのものは持たない。WebSocket の面倒は `useAgent` (agents/react) が見て、
 * こちらは受け取ったフレームを `receive()` / `sync()` から流し込まれるだけ。
 * ここが抱えるのは、React の state に載せると 1 点ごとに再レンダリングが
 * 走ってしまう高頻度な部分 —— op の集合、ポインタ入力、キャンバス描画 —— に限る。
 *
 *   - `hello`  … 初期状態
 *   - `op:*`   … 差分でライブ更新
 *   - `sync()` … サーバの flush (`cf_agent_state`) で丸ごと同期し直す
 */

import type {
	BlendMode,
	CommittedOp,
	DisplaceMode,
	OpPayload,
	Point,
	PostState,
	SubmittedOp,
} from "../agents/post/ops";
import { renderableOps } from "../agents/post/ops";
import type { ClientMessage, ServerMessage } from "../agents/post/protocol";
import { THUMBNAIL_MAX_WIDTH, THUMBNAIL_TYPE } from "./media";
import { renderPost } from "./render";

export type Tool = "stroke" | "displace" | "text";

export type EditorSettings = {
	tool: Tool;
	color: string;
	/** 短辺比。stroke の線幅 / displace の半径 / text の文字サイズに使う。 */
	size: number;
	blend: BlendMode;
	displaceMode: DisplaceMode;
	strength: number;
	/** text ツールで書き込む文字。空なら text ツールは何も置かない。 */
	text: string;
};

export const DEFAULT_SETTINGS: EditorSettings = {
	tool: "stroke",
	color: "#ff0066",
	size: 0.012,
	blend: "normal",
	displaceMode: "smudge",
	strength: 0.6,
	text: "",
};

export type EditorOptions = {
	postId: string;
	/** サムネイルを最後に焼いた時刻（サーバ時刻）。null なら未生成。 */
	thumbnailUpdatedAt: number | null;
	/** 描く直前に呼ばれる。設定は React 側が持つので、常に最新を読みに行く。 */
	getSettings: () => EditorSettings;
	/** サーバへ送る。実体は useAgent が返すソケット。 */
	send: (message: ClientMessage) => void;
	onError?: (message: string) => void;
};

/** 点の送信をまとめる間隔。ここを短くすると滑らかになるが通信量が増える。 */
const EXTEND_INTERVAL_MS = 50;

/** 編集が落ち着いてからサムネイルを焼くまでの待ち時間。 */
const THUMBNAIL_DEBOUNCE_MS = 4000;

export class PostEditor {
	#canvas: HTMLCanvasElement;
	#ctx: CanvasRenderingContext2D;
	#image: HTMLImageElement | null = null;
	#options: EditorOptions;

	#committed = new Map<string, CommittedOp>();
	#pending = new Map<string, SubmittedOp>();
	#userId: string | null = null;

	/** いま自分が描いている op。 */
	#active: { id: string; payload: OpPayload } | null = null;
	#outbox: Point[] = [];
	#extendTimer: ReturnType<typeof setInterval> | null = null;
	#frame = 0;
	#thumbnailTimer: ReturnType<typeof setTimeout> | null = null;
	/** サーバのサムネイルに未反映の変更があるか。焼けたら下ろす。 */
	#thumbnailDirty = false;
	#thumbnailUpdatedAt: number | null;

	constructor(canvas: HTMLCanvasElement, options: EditorOptions) {
		this.#canvas = canvas;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("2d context is unavailable");
		this.#ctx = ctx;
		this.#options = options;
		this.#thumbnailUpdatedAt = options.thumbnailUpdatedAt;
		this.#bindPointer();
	}

	get signedIn(): boolean {
		return this.#userId !== null;
	}

	async loadImage(url: string, aspectRatio: number): Promise<void> {
		// 元画像に落書きを重ねた結果を読み戻す（ディスプレイスメント）ので、
		// CORS が通らない画像はキャンバスを汚染して getImageData が失敗する。
		const image = new Image();
		image.crossOrigin = "anonymous";
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("画像を読み込めませんでした"));
			image.src = url;
		});

		const width = Math.min(1024, image.naturalWidth);
		this.#canvas.width = width;
		this.#canvas.height = Math.round(width / (aspectRatio || 1));
		this.#image = image;
		this.#draw();
	}

	/** キャンバスから離れるときに、抱えているタイマーを落とす。 */
	dispose(): void {
		this.#stopExtendTimer();
		if (this.#thumbnailTimer !== null) clearTimeout(this.#thumbnailTimer);
		this.#thumbnailTimer = null;
	}

	/** 接続が切れたとき。送っても届かないので点の送出を止める。 */
	suspend(): void {
		this.#stopExtendTimer();
	}

	/** 自分の直近の op を取り消す。 */
	undo(): void {
		this.#send({ type: "op:undo" });
	}

	// --- 受信 ---

	/** useAgent の onMessage から。プロトコル外のフレームは黙って捨てる。 */
	receive(raw: unknown): void {
		if (typeof raw !== "string") return;
		let message: ServerMessage;
		try {
			message = JSON.parse(raw) as ServerMessage;
		} catch {
			return;
		}
		this.#receive(message);
	}

	/**
	 * useAgent の onStateUpdate から。サーバが state を flush したときの全体同期で、
	 * 差分を取りこぼしてもここで必ず追いつく。
	 */
	sync(state: PostState): void {
		this.#sync(state);
	}

	#receive(message: ServerMessage): void {
		switch (message.type) {
			case "hello": {
				this.#userId = message.you;
				this.#sync(message.state);
				// サムネイルより新しい op があるなら、開いた時点で焼き直す。
				// これがないと、編集した本人が去ったあと誰も焼き直さない。
				if (this.#thumbnailIsStale()) this.#markThumbnailStale();
				return;
			}

			case "op:began":
				this.#pending.set(message.op.id, message.op);
				return this.#draw();

			case "op:extended": {
				const op = this.#pending.get(message.id);
				if (!op || op.payload.kind === "text") return;
				op.payload.points.push(...message.points);
				return this.#draw();
			}

			case "op:committed":
				this.#pending.delete(message.op.id);
				this.#committed.set(message.op.id, message.op);
				this.#markThumbnailStale();
				return this.#draw();

			case "op:cancelled":
				this.#pending.delete(message.id);
				return this.#draw();

			case "op:undone": {
				const op = this.#committed.get(message.id);
				if (op) op.undone = true;
				this.#markThumbnailStale();
				return this.#draw();
			}

			case "error":
				this.#options.onError?.(message.message);
				// 自分の op が弾かれたら、手元のライブ表示も畳む。
				if (message.ref && this.#active?.id === message.ref) this.#abandonActive();
				return;
		}
	}

	#sync(state: PostState): void {
		this.#committed = new Map(state.committedOps.map((op) => [op.id, op]));
		this.#pending = new Map(state.pendingOps.map((op) => [op.id, op]));
		// 自分が描いている最中の op はサーバの flush より新しいことがあるので、
		// 手元のものを残しておく。
		this.#draw();
	}

	// --- 描画 ---

	#draw(): void {
		if (this.#frame) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0;
			this.#renderNow();
		});
	}

	/** rAF を待たずにいま描く。サムネイルを焼く直前など、確実に最新にしたいとき用。 */
	#renderNow(): void {
		if (this.#frame) {
			cancelAnimationFrame(this.#frame);
			this.#frame = 0;
		}
		renderPost(this.#ctx, this.#image, renderableOps(this.#snapshot()));
	}

	#snapshot(): PostState {
		return {
			post: null,
			committedOps: [...this.#committed.values()],
			pendingOps: [...this.#pending.values()],
		};
	}

	// --- サムネイル ---

	/** サーバのサムネイルより新しい op を持っているか。 */
	#thumbnailIsStale(): boolean {
		let newest = 0;
		for (const op of this.#committed.values()) {
			if (op.committedAt > newest) newest = op.committedAt;
		}
		if (newest === 0) return false;
		return this.#thumbnailUpdatedAt === null || newest > this.#thumbnailUpdatedAt;
	}

	#markThumbnailStale(): void {
		this.#thumbnailDirty = true;
		this.#scheduleThumbnail(THUMBNAIL_DEBOUNCE_MS);
	}

	/**
	 * 編集が落ち着いたら、いまのキャンバスを縮小して一覧用に焼き直す。
	 *
	 * Workers に Canvas が無く op を再生できるのはブラウザだけなので、
	 * 描画済みのこちらから上げる。開いている全員が上げに来るが、権利を取れるのは
	 * 1 人だけ。取れなかった側は焼けていない変更を抱えたまま待ち、間隔が明けたら
	 * 出し直す（焼けたら #thumbnailDirty が下りて止まる）。
	 */
	#scheduleThumbnail(delayMs: number): void {
		if (!this.signedIn || !this.#thumbnailDirty) return;
		if (this.#thumbnailTimer !== null) clearTimeout(this.#thumbnailTimer);
		this.#thumbnailTimer = setTimeout(() => {
			this.#thumbnailTimer = null;
			void this.#pushThumbnail();
		}, delayMs);
	}

	async #pushThumbnail(): Promise<void> {
		const postId = this.#options.postId;
		if (!this.#thumbnailDirty) return;

		// 待っている間に描画が rAF 待ちのまま止まっていることがある
		// （背景タブでは rAF が回らない）。焼く直前に必ず追いつかせる。
		this.#renderNow();

		const source = this.#canvas;
		const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / source.width);
		const thumb = document.createElement("canvas");
		thumb.width = Math.max(1, Math.round(source.width * scale));
		thumb.height = Math.max(1, Math.round(source.height * scale));
		thumb.getContext("2d")?.drawImage(source, 0, 0, thumb.width, thumb.height);

		const blob = await new Promise<Blob | null>((resolve) =>
			thumb.toBlob(resolve, THUMBNAIL_TYPE, 0.8),
		);
		if (!blob) return;

		try {
			const response = await fetch(`/api/posts/${postId}/thumbnail`, {
				method: "PUT",
				headers: { "content-type": THUMBNAIL_TYPE },
				body: blob,
			});

			if (response.ok) {
				this.#thumbnailDirty = false;
				this.#thumbnailUpdatedAt = Date.now();
				return;
			}

			// 他の誰かが直前に焼いた。こちらの変更はまだ載っていないかもしれないので、
			// 間隔が明けたら出し直す。同時に待っている全員が同じ瞬間に殺到しないよう散らす。
			if (response.status === 429) {
				const retryAfterMs = Number(response.headers.get("retry-after") ?? 30) * 1000;
				this.#scheduleThumbnail(retryAfterMs + Math.random() * 3000);
			}
		} catch {
			// 一覧の見た目が少し古くなるだけなので、失敗しても編集は続行させる。
		}
	}

	// --- 入力 ---

	#bindPointer(): void {
		const canvas = this.#canvas;

		canvas.addEventListener("pointerdown", (event) => {
			if (!this.signedIn || event.button !== 0) return;
			canvas.setPointerCapture(event.pointerId);
			this.#beginOp(this.#toPoint(event));
		});

		canvas.addEventListener("pointermove", (event) => {
			if (!this.#active) return;
			this.#outbox.push(this.#toPoint(event));
			this.#appendLocal(this.#toPoint(event));
		});

		const finish = () => this.#commitActive();
		canvas.addEventListener("pointerup", finish);
		canvas.addEventListener("pointercancel", () => this.#abandonActive());
		canvas.addEventListener("pointerleave", finish);
	}

	#toPoint(event: PointerEvent): Point {
		const rect = this.#canvas.getBoundingClientRect();
		const point: Point = {
			x: (event.clientX - rect.left) / rect.width,
			y: (event.clientY - rect.top) / rect.height,
		};
		if (event.pressure > 0 && event.pressure !== 0.5) point.p = event.pressure;
		return point;
	}

	#beginOp(point: Point): void {
		const { tool, color, size, blend, displaceMode, strength, text } = this.#options.getSettings();

		let payload: OpPayload;
		if (tool === "stroke") {
			payload = { kind: "stroke", points: [point], color, width: size, blend };
		} else if (tool === "displace") {
			payload = { kind: "displace", points: [point], radius: size * 8, strength, mode: displaceMode };
		} else {
			// 文字は UI 側で入力させる。未入力なら置くものがない。
			const body = text.trim();
			if (!body) return;
			payload = { kind: "text", at: point, body, size: size * 4, color, rotation: 0 };
		}

		const id = crypto.randomUUID();
		this.#active = { id, payload };
		this.#send({ type: "op:begin", id, payload });

		// 自分の画面にも即座に出す。サーバは送信元に op:began を返さない。
		this.#pending.set(id, {
			id,
			authorId: this.#userId ?? "me",
			payload,
			connectionId: "self",
			startedAt: Date.now(),
			updatedAt: Date.now(),
		});
		this.#draw();

		// テキストは点を伸ばさないのでその場で確定。
		if (payload.kind === "text") this.#commitActive();
		else this.#startExtendTimer();
	}

	#appendLocal(point: Point): void {
		const active = this.#active;
		if (!active || active.payload.kind === "text") return;
		active.payload.points.push(point);
		this.#draw();
	}

	#startExtendTimer(): void {
		this.#stopExtendTimer();
		this.#extendTimer = setInterval(() => this.#flushOutbox(), EXTEND_INTERVAL_MS);
	}

	#stopExtendTimer(): void {
		if (this.#extendTimer === null) return;
		clearInterval(this.#extendTimer);
		this.#extendTimer = null;
	}

	#flushOutbox(): void {
		const active = this.#active;
		if (!active || this.#outbox.length === 0) return;
		const points = this.#outbox.splice(0, this.#outbox.length);
		this.#send({ type: "op:extend", id: active.id, points });
	}

	#commitActive(): void {
		const active = this.#active;
		if (!active) return;
		this.#flushOutbox();
		this.#stopExtendTimer();
		this.#send({ type: "op:commit", id: active.id });
		this.#active = null;
		this.#outbox = [];
	}

	#abandonActive(): void {
		const active = this.#active;
		if (!active) return;
		this.#stopExtendTimer();
		this.#pending.delete(active.id);
		this.#active = null;
		this.#outbox = [];
		this.#draw();
	}

	#send(message: ClientMessage): void {
		this.#options.send(message);
	}
}
