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
import { applyOps, renderPost } from "./render";

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
	/** 描く直前に呼ばれる。設定は React 側が持つので、常に最新を読みに行く。 */
	getSettings: () => EditorSettings;
	/** サーバへ送る。実体は useAgent が返すソケット。 */
	send: (message: ClientMessage) => void;
	onError?: (message: string) => void;
	/**
	 * 見せてよい絵が出そろったとき、一度だけ呼ぶ。
	 *
	 * 元画像とサーバの初期状態が揃って、それをキャンバスに焼き終えた時点。
	 * ロード表示を畳むのはここで、それより早く畳むと「元画像だけの絵」を
	 * 一瞬見せてから op が乗ることになる。
	 */
	onReady?: () => void;
};

/** 点の送信をまとめる間隔。ここを短くすると滑らかになるが通信量が増える。 */
const EXTEND_INTERVAL_MS = 50;

/** キャンバスの最大幅。元画像がこれより大きければ縮める。 */
const MAX_CANVAS_WIDTH = 1024;

/**
 * 初期状態を待つのをあきらめる時間。
 *
 * 接続できないままだと `hello` は永遠に来ない。ロード表示を出したまま
 * 固まるくらいなら、手元にあるもの（元画像だけ）を出したほうがいい。
 */
const READY_TIMEOUT_MS = 4000;

export class PostEditor {
	#canvas: HTMLCanvasElement;
	#ctx: CanvasRenderingContext2D;
	#image: HTMLImageElement | null = null;
	#options: EditorOptions;

	#committed = new Map<string, CommittedOp>();
	#pending = new Map<string, SubmittedOp>();
	#userId: string | null = null;

	/**
	 * 元画像と確定済み op だけを焼いた下地。
	 *
	 * 1 ストロークのあいだ、確定済みの中身は動かない。にもかかわらず毎フレーム
	 * 全部を焼き直すと、他人のぶんも含めた歪みの読み書きが点を打つたびに走る。
	 * ここに取っておいて、毎フレーム重ねるのは未確定ぶんだけにする。
	 */
	#layer: HTMLCanvasElement | null = null;
	#layerStale = true;

	/** ロード表示を畳んでよいかの材料。揃って 1 度描いたら `onReady`。 */
	#imageSettled = false;
	#stateSettled = false;
	#ready = false;
	#readyTimer: ReturnType<typeof setTimeout> | null = null;

	/** いま自分が描いている op。 */
	#active: { id: string; payload: OpPayload } | null = null;
	#outbox: Point[] = [];
	#extendTimer: ReturnType<typeof setInterval> | null = null;
	#frame = 0;

	constructor(canvas: HTMLCanvasElement, options: EditorOptions) {
		this.#canvas = canvas;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("2d context is unavailable");
		this.#ctx = ctx;
		this.#options = options;
		this.#bindPointer();
		this.#readyTimer = setTimeout(() => this.#settleState(), READY_TIMEOUT_MS);
	}

	get signedIn(): boolean {
		return this.#userId !== null;
	}

	async loadImage(url: string, aspectRatio: number): Promise<void> {
		// 画像を待つ前に寸法を確定させておく。こうしておけば、画像が読めなくても
		// 履歴の op はキャンバスに出る（真っ白にならない）。
		this.#resize(MAX_CANVAS_WIDTH, aspectRatio);

		// 元画像に落書きを重ねた結果を読み戻す（ディスプレイスメント）ので、
		// CORS が通らない画像はキャンバスを汚染して getImageData が失敗する。
		const image = new Image();
		image.crossOrigin = "anonymous";
		try {
			await new Promise<void>((resolve, reject) => {
				image.onload = () => resolve();
				image.onerror = () => reject(new Error("画像を読み込めませんでした"));
				image.src = url;
			});
		} catch (error) {
			// 元画像が無くても op だけは出す。待ち続けても出てくるものはない。
			this.#imageSettled = true;
			this.#draw();
			throw error;
		}

		this.#resize(Math.min(MAX_CANVAS_WIDTH, image.naturalWidth), aspectRatio);
		this.#image = image;
		this.#imageSettled = true;
		this.#layerStale = true;
		this.#draw();
	}

	/** キャンバスの実ピクセル寸法を決める。幅を変えると中身は消えるので描き直す。 */
	#resize(width: number, aspectRatio: number): void {
		this.#canvas.width = width;
		this.#canvas.height = Math.round(width / (aspectRatio || 1));
		this.#layerStale = true;
		this.#draw();
	}

	/** キャンバスから離れるときに、抱えているタイマーを落とす。 */
	dispose(): void {
		this.#stopExtendTimer();
		this.#clearReadyTimer();
		this.#layer = null;
		this.#layerStale = true;
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
				this.#layerStale = true;
				return this.#draw();

			case "op:cancelled":
				this.#pending.delete(message.id);
				return this.#draw();

			case "op:undone": {
				const op = this.#committed.get(message.id);
				if (op) op.undone = true;
				this.#layerStale = true;
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
		this.#layerStale = true;
		this.#settleState();
		// 自分が描いている最中の op はサーバの flush より新しいことがあるので、
		// 手元のものを残しておく。
		this.#draw();
	}

	// --- ロード表示 ---

	#settleState(): void {
		this.#clearReadyTimer();
		if (this.#stateSettled) return;
		this.#stateSettled = true;
		this.#draw();
	}

	#clearReadyTimer(): void {
		if (this.#readyTimer === null) return;
		clearTimeout(this.#readyTimer);
		this.#readyTimer = null;
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

		const layer = this.#committedLayer();
		if (layer) {
			const ctx = this.#ctx;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalCompositeOperation = "source-over";
			ctx.clearRect(0, 0, layer.width, layer.height);
			// 同じ寸法・等倍・透明な下地の上なので、これは画素の複写になる。
			ctx.drawImage(layer, 0, 0);
			applyOps(ctx, this.#renderable([], [...this.#pending.values()]));
		} else {
			// 下地を用意できないときは、その場で全部焼く。
			renderPost(this.#ctx, this.#image, renderableOps(this.#snapshot()));
		}

		this.#announceReady();
	}

	/** 焼き終えた直後に 1 度だけ。ここより早く知らせると、途中の絵が出てしまう。 */
	#announceReady(): void {
		if (this.#ready || !this.#imageSettled || !this.#stateSettled) return;
		this.#ready = true;
		this.#options.onReady?.();
	}

	/** 元画像と確定済み op を焼いた下地。作れないときだけ null。 */
	#committedLayer(): HTMLCanvasElement | null {
		const { width, height } = this.#canvas;
		if (width === 0 || height === 0) return null;

		const layer = (this.#layer ??= document.createElement("canvas"));
		if (layer.width !== width || layer.height !== height) {
			layer.width = width;
			layer.height = height;
			this.#layerStale = true;
		}
		if (!this.#layerStale) return layer;

		// 歪みがこの下地を読み戻す。
		const ctx = layer.getContext("2d", { willReadFrequently: true });
		if (!ctx) return null;

		renderPost(ctx, this.#image, this.#renderable([...this.#committed.values()], []));
		this.#layerStale = false;
		return layer;
	}

	/** 描画順の決め方は 1 か所に寄せる。下地と未確定ぶんで別々に呼ぶ。 */
	#renderable(committedOps: CommittedOp[], pendingOps: SubmittedOp[]) {
		return renderableOps({ post: null, committedOps, pendingOps });
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
		const { tool, color, size, blend, displaceMode, strength, text } = this.#options.getSettings();

		let payload: OpPayload;
		if (tool === "stroke") {
			payload = { kind: "stroke", points: [point], color, width: size, blend };
		} else if (tool === "displace") {
			payload = {
				kind: "displace",
				points: [point],
				radius: size * 8,
				strength,
				mode: displaceMode,
			};
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
