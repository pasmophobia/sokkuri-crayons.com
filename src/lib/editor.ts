/**
 * 投稿ページのクライアント側コントローラ。
 *
 * Post Agent と WebSocket で繋ぎ、
 *   - `hello` で初期状態を受け取り
 *   - `op:*` の差分でライブ更新し
 *   - `cf_agent_state` （サーバの flush）が来たら丸ごと同期し直す
 * という流れで committed / pending を持つ。描画は rAF でまとめる。
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
};

export type EditorEvents = {
	onIdentity?: (userId: string | null, displayName: string | null) => void;
	onError?: (message: string) => void;
	onStatus?: (status: "connecting" | "open" | "closed") => void;
};

/** 点の送信をまとめる間隔。ここを短くすると滑らかになるが通信量が増える。 */
const EXTEND_INTERVAL_MS = 50;

export class PostEditor {
	#canvas: HTMLCanvasElement;
	#ctx: CanvasRenderingContext2D;
	#image: HTMLImageElement | null = null;
	#socket: WebSocket | null = null;
	#events: EditorEvents;

	#committed = new Map<string, CommittedOp>();
	#pending = new Map<string, SubmittedOp>();
	#userId: string | null = null;

	/** いま自分が描いている op。 */
	#active: { id: string; payload: OpPayload } | null = null;
	#outbox: Point[] = [];
	#extendTimer: ReturnType<typeof setInterval> | null = null;
	#frame = 0;

	settings: EditorSettings = {
		tool: "stroke",
		color: "#ff0066",
		size: 0.012,
		blend: "normal",
		displaceMode: "smudge",
		strength: 0.6,
	};

	constructor(canvas: HTMLCanvasElement, events: EditorEvents = {}) {
		this.#canvas = canvas;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("2d context is unavailable");
		this.#ctx = ctx;
		this.#events = events;
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

	connect(postId: string): void {
		this.#events.onStatus?.("connecting");
		const scheme = location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(`${scheme}//${location.host}/agents/post/${postId}`);
		this.#socket = socket;

		socket.addEventListener("open", () => this.#events.onStatus?.("open"));
		socket.addEventListener("close", () => {
			this.#events.onStatus?.("closed");
			this.#stopExtendTimer();
		});
		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			this.#receive(JSON.parse(event.data));
		});
	}

	disconnect(): void {
		this.#stopExtendTimer();
		this.#socket?.close();
		this.#socket = null;
	}

	/** 自分の直近の op を取り消す。 */
	undo(): void {
		this.#send({ type: "op:undo" });
	}

	// --- 受信 ---

	#receive(message: ServerMessage | { type: "cf_agent_state"; state: PostState }): void {
		switch (message.type) {
			case "hello": {
				this.#userId = message.you;
				this.#events.onIdentity?.(message.you, message.displayName);
				this.#sync(message.state);
				return;
			}
			// サーバが state を flush したときの全体同期。差分を取りこぼしても
			// ここで必ず追いつく。
			case "cf_agent_state":
				this.#sync(message.state);
				return;

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
				return this.#draw();

			case "op:cancelled":
				this.#pending.delete(message.id);
				return this.#draw();

			case "op:undone": {
				const op = this.#committed.get(message.id);
				if (op) op.undone = true;
				return this.#draw();
			}

			case "error":
				this.#events.onError?.(message.message);
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
			renderPost(this.#ctx, this.#image, renderableOps(this.#snapshot()));
		});
	}

	#snapshot(): PostState {
		return {
			post: null,
			committedOps: [...this.#committed.values()],
			pendingOps: [...this.#pending.values()],
		};
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
		const { tool, color, size, blend, displaceMode, strength } = this.settings;

		let payload: OpPayload;
		if (tool === "stroke") {
			payload = { kind: "stroke", points: [point], color, width: size, blend };
		} else if (tool === "displace") {
			payload = { kind: "displace", points: [point], radius: size * 8, strength, mode: displaceMode };
		} else {
			const body = prompt("書き込む文字");
			if (!body?.trim()) return;
			payload = {
				kind: "text",
				at: point,
				body: body.trim().slice(0, 140),
				size: size * 4,
				color,
				rotation: 0,
			};
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
		if (this.#socket?.readyState !== WebSocket.OPEN) return;
		this.#socket.send(JSON.stringify(message));
	}
}
