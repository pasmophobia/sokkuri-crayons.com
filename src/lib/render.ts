/**
 * op をキャンバスに焼くレンダラ。
 *
 * op は正規化座標 (0..1) で来るので、ここでキャンバスの実ピクセルに戻す。
 * 描画順は committed (seq 昇順) → pending の順で、`renderableOps` が決める。
 *
 * ディスプレイスメントは「その時点までに描かれた内容」を歪ませる必要があるため、
 * op の順番どおりに逐次適用する。効果範囲だけ getImageData / putImageData する
 * ので、半径が画像全体でなければ十分に軽い。
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

export type Renderable = CommittedOp | SubmittedOp;

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
	normal: "source-over",
	multiply: "multiply",
	screen: "screen",
	overlay: "overlay",
};

/** swirl の最大回転量。 */
const MAX_SWIRL = Math.PI;

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

	for (const op of ops) {
		applyOp(ctx, op.payload, width, height);
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
			return applyDisplace(ctx, payload, width, height);
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

function drawText(
	ctx: CanvasRenderingContext2D,
	op: TextOp,
	width: number,
	height: number,
): void {
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

function applyDisplace(
	ctx: CanvasRenderingContext2D,
	op: DisplaceOp,
	width: number,
	height: number,
): void {
	const short = Math.min(width, height);
	const radius = Math.max(2, op.radius * short);

	ctx.globalCompositeOperation = "source-over";

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

		warpDisc(ctx, width, height, cx, cy, radius, (dx, dy, t) => {
			// 効果は中心で最大、縁でゼロ。
			const falloff = 1 - t;

			switch (op.mode) {
				case "swirl": {
					const angle = -op.strength * MAX_SWIRL * falloff;
					const cos = Math.cos(angle);
					const sin = Math.sin(angle);
					return [dx * cos - dy * sin, dx * sin + dy * cos];
				}
				case "smudge": {
					const shift = op.strength * radius * 0.5 * falloff;
					return [dx - dirX * shift, dy - dirY * shift];
				}
				case "bulge":
				case "pinch": {
					// 出力側の距離を入力側に引き戻す。指数 > 1 で中心が拡大される。
					const signed = op.mode === "pinch" ? -op.strength : op.strength;
					const exponent = 1 + signed;
					if (t === 0) return [0, 0];
					const scale = Math.pow(t, exponent) / t;
					return [dx * scale, dy * scale];
				}
			}
		});
	});
}

/**
 * 中心 (cx, cy) 半径 radius の円内を、`inverse` が返す「入力側の相対座標」で
 * サンプリングし直す。`inverse` は出力座標 (dx, dy) と正規化距離 t を受け取り、
 * 対応する入力座標 (相対) を返す。
 */
function warpDisc(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	cx: number,
	cy: number,
	radius: number,
	inverse: (dx: number, dy: number, t: number) => [number, number],
): void {
	const left = Math.max(0, Math.floor(cx - radius));
	const top = Math.max(0, Math.floor(cy - radius));
	const right = Math.min(width, Math.ceil(cx + radius));
	const bottom = Math.min(height, Math.ceil(cy + radius));
	const boxWidth = right - left;
	const boxHeight = bottom - top;
	if (boxWidth <= 0 || boxHeight <= 0) return;

	const source = ctx.getImageData(left, top, boxWidth, boxHeight);
	const target = ctx.createImageData(boxWidth, boxHeight);
	target.data.set(source.data);

	for (let y = 0; y < boxHeight; y++) {
		for (let x = 0; x < boxWidth; x++) {
			const dx = left + x + 0.5 - cx;
			const dy = top + y + 0.5 - cy;
			const distance = Math.hypot(dx, dy);
			if (distance >= radius) continue;

			const [sx, sy] = inverse(dx, dy, distance / radius);
			sample(source, boxWidth, boxHeight, cx - left + sx - 0.5, cy - top + sy - 0.5, target.data, (y * boxWidth + x) * 4);
		}
	}

	ctx.putImageData(target, left, top);
}

/** バイリニア補間で 1 画素を取り出し、`out[offset..]` に書く。 */
function sample(
	source: ImageData,
	width: number,
	height: number,
	x: number,
	y: number,
	out: Uint8ClampedArray,
	offset: number,
): void {
	const clampedX = Math.min(width - 1, Math.max(0, x));
	const clampedY = Math.min(height - 1, Math.max(0, y));
	const x0 = Math.floor(clampedX);
	const y0 = Math.floor(clampedY);
	const x1 = Math.min(width - 1, x0 + 1);
	const y1 = Math.min(height - 1, y0 + 1);
	const fx = clampedX - x0;
	const fy = clampedY - y0;

	const data = source.data;
	const i00 = (y0 * width + x0) * 4;
	const i10 = (y0 * width + x1) * 4;
	const i01 = (y1 * width + x0) * 4;
	const i11 = (y1 * width + x1) * 4;

	for (let channel = 0; channel < 4; channel++) {
		const top = data[i00 + channel]! * (1 - fx) + data[i10 + channel]! * fx;
		const bottom = data[i01 + channel]! * (1 - fx) + data[i11 + channel]! * fx;
		out[offset + channel] = top * (1 - fy) + bottom * fy;
	}
}
