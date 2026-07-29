/**
 * op をキャンバスに焼くレンダラ。
 *
 * op は正規化座標 (0..1) で来るので、ここでキャンバスの実ピクセルに戻す。
 * 描画順は committed (seq 昇順) → pending の順で、`renderableOps` が決める。
 *
 * 線と文字は Canvas2D に任せる。歪み (displace) だけは画素を読み戻して書き直す
 * 処理なので、`warp.ts`（wasm ／ その JS 同型実装）に渡す。歪みは op の順番どおりに
 * 効かせる必要があるが、点ごとに `getImageData` / `putImageData` していると
 * 往復だけで時間が溶ける。連続する歪みは 1 枚の矩形にまとめて読み書きする。
 */

import type {
	BlendMode,
	CommittedOp,
	DisplaceOp,
	OpPayload,
	StrokeOp,
	SubmittedOp,
	TextOp,
} from "../agents/post/ops";
import {
	boundsArea,
	mergeBounds,
	runWarps,
	warpBounds,
	warpEngine,
	WARP_MODE,
	type Bounds,
	type WarpCall,
} from "./warp";

export type Renderable = CommittedOp | SubmittedOp;

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
	normal: "source-over",
	multiply: "multiply",
	screen: "screen",
	overlay: "overlay",
};

const DISPLACE_MODE = {
	swirl: WARP_MODE.swirl,
	smudge: WARP_MODE.smudge,
	bulge: WARP_MODE.bulge,
	pinch: WARP_MODE.pinch,
} as const;

/**
 * 矩形を 1 つ増やすことの固定費を、画素数に換算した目安。
 *
 * まとめれば往復は減るが、離れた点まで巻き込むと触らない画素を運ぶだけになる。
 * この画素数ぶんより余分に広がるなら、矩形を分けた方が安い。
 */
const BATCH_OVERHEAD_PIXELS = 4096;

export function renderPost(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource | null,
	ops: Renderable[],
): void {
	const { width, height } = ctx.canvas;

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "source-over";
	ctx.clearRect(0, 0, width, height);
	if (image) ctx.drawImage(image, 0, 0, width, height);

	applyOps(ctx, ops);
}

/**
 * すでにある内容の上に op を重ねる。下地は消さない。
 *
 * 確定済みを焼いたキャンバスを使い回して、未確定ぶんだけを毎フレーム重ねたい
 * 呼び出し側（`PostEditor`）のために `renderPost` から分けてある。
 */
export function applyOps(ctx: CanvasRenderingContext2D, ops: Renderable[]): void {
	const { width, height } = ctx.canvas;

	// 歪みが出てくるより前に読み込みを始めておく。
	warpEngine();

	for (let index = 0; index < ops.length;) {
		const payload = ops[index]!.payload;
		if (payload.kind !== "displace") {
			applyOp(ctx, payload, width, height);
			index += 1;
			continue;
		}

		// 連続する歪みはまとめて読み書きできる。あいだに線や文字が挟まると
		// その結果を下地として読み直す必要があるので、そこで切る。
		const run: DisplaceOp[] = [];
		while (index < ops.length) {
			const next = ops[index]!.payload;
			if (next.kind !== "displace") break;
			run.push(next);
			index += 1;
		}
		applyDisplaceRun(ctx, run, width, height);
	}

	ctx.globalCompositeOperation = "source-over";
}

function applyOp(
	ctx: CanvasRenderingContext2D,
	payload: OpPayload,
	width: number,
	height: number,
): void {
	switch (payload.kind) {
		case "stroke":
			return drawStroke(ctx, payload, width, height);
		case "text":
			return drawText(ctx, payload, width, height);
		case "displace":
			return applyDisplaceRun(ctx, [payload], width, height);
	}
}

function drawStroke(
	ctx: CanvasRenderingContext2D,
	op: StrokeOp,
	width: number,
	height: number,
): void {
	if (op.points.length === 0) return;

	const short = Math.min(width, height);
	const lineWidth = Math.max(1, op.width * short);

	ctx.globalCompositeOperation = BLEND[op.blend];
	ctx.strokeStyle = op.color;
	ctx.fillStyle = op.color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	// 点が 1 つだけなら線にならないので、点そのものを打つ。
	if (op.points.length === 1) {
		const only = op.points[0]!;
		ctx.beginPath();
		ctx.arc(only.x * width, only.y * height, lineWidth / 2, 0, Math.PI * 2);
		ctx.fill();
		return;
	}

	ctx.beginPath();
	op.points.forEach((point, index) => {
		const x = point.x * width;
		const y = point.y * height;
		if (index === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	});
	ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, op: TextOp, width: number, height: number): void {
	const short = Math.min(width, height);

	ctx.save();
	ctx.globalCompositeOperation = "source-over";
	ctx.translate(op.at.x * width, op.at.y * height);
	ctx.rotate(op.rotation);
	ctx.fillStyle = op.color;
	ctx.font = `700 ${Math.max(8, op.size * short)}px ui-sans-serif, system-ui, sans-serif`;
	ctx.textBaseline = "middle";
	ctx.textAlign = "center";
	ctx.fillText(op.body, 0, 0);
	ctx.restore();
}

/** 歪み op を正規化座標のまま 1 点ずつの効果に開く。 */
function displaceCalls(op: DisplaceOp, width: number, height: number): WarpCall[] {
	const short = Math.min(width, height);
	const radius = Math.max(2, op.radius * short);
	const mode = DISPLACE_MODE[op.mode];

	const calls: WarpCall[] = [];
	op.points.forEach((point, index) => {
		const cx = point.x * width;
		const cy = point.y * height;

		// smudge は直前の点からの向きに引きずる。始点には向きがないので飛ばす。
		let dirX = 0;
		let dirY = 0;
		if (op.mode === "smudge") {
			const previous = op.points[index - 1];
			if (!previous) return;
			dirX = cx - previous.x * width;
			dirY = cy - previous.y * height;
			const length = Math.hypot(dirX, dirY);
			if (length === 0) return;
			dirX /= length;
			dirY /= length;
		}

		calls.push({ cx, cy, radius, mode, strength: op.strength, dirX, dirY });
	});
	return calls;
}

/** 連続する歪み op を、読み書きの往復をまとめながら適用する。 */
function applyDisplaceRun(
	ctx: CanvasRenderingContext2D,
	ops: DisplaceOp[],
	width: number,
	height: number,
): void {
	ctx.globalCompositeOperation = "source-over";

	const entries: { call: WarpCall; bounds: Bounds }[] = [];
	for (const op of ops) {
		for (const call of displaceCalls(op, width, height)) {
			const bounds = warpBounds(call, width, height);
			if (bounds) entries.push({ call, bounds });
		}
	}
	if (entries.length === 0) return;

	let batch: WarpCall[] = [];
	let union: Bounds | null = null;

	const flush = () => {
		if (union) drawBatch(ctx, union, batch, width, height);
		batch = [];
		union = null;
	};

	for (const entry of entries) {
		if (union) {
			const merged = mergeBounds(union, entry.bounds);
			// 広がるぶんが、矩形を 1 つ増やす固定費より高くつくならそこで切る。
			const grown = boundsArea(merged) - boundsArea(union);
			if (grown > boundsArea(entry.bounds) + BATCH_OVERHEAD_PIXELS) flush();
			else union = merged;
		}
		union ??= entry.bounds;
		batch.push(entry.call);
	}
	flush();
}

function drawBatch(
	ctx: CanvasRenderingContext2D,
	bounds: Bounds,
	calls: WarpCall[],
	width: number,
	height: number,
): void {
	const boxWidth = bounds.right - bounds.left;
	const boxHeight = bounds.bottom - bounds.top;
	const image = ctx.getImageData(bounds.left, bounds.top, boxWidth, boxHeight);
	runWarps(image.data, width, height, bounds.left, bounds.top, boxWidth, boxHeight, calls);
	ctx.putImageData(image, bounds.left, bounds.top);
}
