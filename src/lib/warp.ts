/**
 * ディスプレイスメント（画素の歪み）の画素演算。
 *
 * 実装は 2 つある。`crates/render` の wasm と、その下に置いた JS の同型実装。
 * どちらも同じ引数で同じ RGBA バッファを書き換える。wasm はブラウザでしか
 * 読み込まないので、まだ読み込めていない間・SSR・テストでは JS 側が受け持つ。
 * 2 つが一致していることは `warp.test.ts` が両方を突き合わせて確かめている。
 *
 * どちらの実装も、キャンバスではなく「JS が読み出した矩形」の上で動く。
 * 歪みは点ごとに下地を読み直す必要があるが、キャンバス越しにやると点の数だけ
 * `getImageData` / `putImageData` が要る。連続する点をこのバッファの上で
 * 処理してしまえば、往復は矩形 1 つにつき 1 回で済む。
 *
 * 座標系は 2 つある。`cx` / `cy` / `radius` と効果範囲はキャンバスの実座標。
 * バッファは矩形 (`offsetX`, `offsetY`, `bufferWidth`, `bufferHeight`) の
 * ぶんしか無いので、添字を作るところでその原点を引く。
 */

import wasmUrl from "../wasm/render.wasm?url";

/** wasm 側の `mode` と対応する。数値そのものが ABI なので並べ替えない。 */
export const WARP_MODE = { swirl: 0, smudge: 1, bulge: 2, pinch: 3 } as const;

export type WarpMode = (typeof WARP_MODE)[keyof typeof WARP_MODE];

/** 1 点ぶんの歪み。座標も半径もキャンバスの実ピクセル。 */
export type WarpCall = {
	cx: number;
	cy: number;
	radius: number;
	mode: WarpMode;
	strength: number;
	/** smudge の引きずり方向（正規化済み）。他のモードでは見ない。 */
	dirX: number;
	dirY: number;
};

/** 半開区間。`right` / `bottom` は含まない。 */
export type Bounds = { left: number; top: number; right: number; bottom: number };

/** swirl の最大回転量。 */
const MAX_SWIRL = Math.PI;

/** 効果範囲をキャンバス内に収めて返す。範囲が空なら null。 */
export function warpBounds(call: WarpCall, width: number, height: number): Bounds | null {
	const left = Math.max(0, Math.floor(call.cx - call.radius));
	const top = Math.max(0, Math.floor(call.cy - call.radius));
	const right = Math.min(width, Math.ceil(call.cx + call.radius));
	const bottom = Math.min(height, Math.ceil(call.cy + call.radius));
	if (right - left <= 0 || bottom - top <= 0) return null;
	return { left, top, right, bottom };
}

export function boundsArea(bounds: Bounds): number {
	return (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
}

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
	return {
		left: Math.min(a.left, b.left),
		top: Math.min(a.top, b.top),
		right: Math.max(a.right, b.right),
		bottom: Math.max(a.bottom, b.bottom),
	};
}

/**
 * 矩形 `data` に対して `calls` を順に適用する。
 *
 * 各点は「その前の点まで反映済みの画素」を読む。読み出し元だけを退避して
 * 書き込みは `data` に直接返すので、点の順番がそのまま効き方の順番になる。
 */
export function runWarps(
	data: Uint8ClampedArray,
	canvasWidth: number,
	canvasHeight: number,
	offsetX: number,
	offsetY: number,
	bufferWidth: number,
	bufferHeight: number,
	calls: WarpCall[],
): void {
	const wasm = warpEngine();
	if (!wasm) {
		for (const call of calls) {
			warpJs(data, canvasWidth, canvasHeight, offsetX, offsetY, bufferWidth, bufferHeight, call);
		}
		return;
	}

	const pointer = wasm.frame(data.length);
	new Uint8Array(wasm.memory.buffer, pointer, data.length).set(data);
	for (const call of calls) {
		wasm.warp(
			canvasWidth,
			canvasHeight,
			offsetX,
			offsetY,
			bufferWidth,
			bufferHeight,
			call.cx,
			call.cy,
			call.radius,
			call.mode,
			call.strength,
			call.dirX,
			call.dirY,
		);
	}
	// 途中で memory.grow が起きると ArrayBuffer は切り離される。先頭は動かないが、
	// ビューは作り直さないと読めない。
	data.set(new Uint8Array(wasm.memory.buffer, pointer, data.length));
}

// --- JS 実装（wasm の同型・かつ参照実装） ---

export function warpJs(
	data: Uint8ClampedArray,
	canvasWidth: number,
	canvasHeight: number,
	offsetX: number,
	offsetY: number,
	bufferWidth: number,
	bufferHeight: number,
	call: WarpCall,
): void {
	const bounds = warpBounds(call, canvasWidth, canvasHeight);
	if (!bounds) return;
	const { left, top, right, bottom } = bounds;
	if (
		left < offsetX ||
		top < offsetY ||
		right > offsetX + bufferWidth ||
		bottom > offsetY + bufferHeight
	) {
		return;
	}

	const boxWidth = right - left;
	const boxHeight = bottom - top;
	const stride = bufferWidth * 4;

	// 歪みは「歪ませる前の画素」を読む。書き戻しと読み出しが混ざらないよう退避する。
	const source = new Uint8ClampedArray(boxWidth * boxHeight * 4);
	for (let y = 0; y < boxHeight; y++) {
		const from = (top + y - offsetY) * stride + (left - offsetX) * 4;
		source.set(data.subarray(from, from + boxWidth * 4), y * boxWidth * 4);
	}

	const { cx, cy, radius, strength } = call;
	for (let y = 0; y < boxHeight; y++) {
		for (let x = 0; x < boxWidth; x++) {
			const dx = left + x + 0.5 - cx;
			const dy = top + y + 0.5 - cy;
			const distance = Math.sqrt(dx * dx + dy * dy);
			if (distance >= radius) continue;

			// 効果は中心で最大、縁でゼロ。
			const t = distance / radius;
			const falloff = 1 - t;

			let sx: number;
			let sy: number;
			switch (call.mode) {
				case WARP_MODE.swirl: {
					const angle = -strength * MAX_SWIRL * falloff;
					const cos = Math.cos(angle);
					const sin = Math.sin(angle);
					sx = dx * cos - dy * sin;
					sy = dx * sin + dy * cos;
					break;
				}
				case WARP_MODE.smudge: {
					const shift = strength * radius * 0.5 * falloff;
					sx = dx - call.dirX * shift;
					sy = dy - call.dirY * shift;
					break;
				}
				default: {
					// 出力側の距離を入力側に引き戻す。指数 > 1 で中心が拡大される。
					const signed = call.mode === WARP_MODE.pinch ? -strength : strength;
					if (t === 0) {
						sx = 0;
						sy = 0;
					} else {
						const scale = Math.pow(t, 1 + signed) / t;
						sx = dx * scale;
						sy = dy * scale;
					}
					break;
				}
			}

			sample(
				source,
				boxWidth,
				boxHeight,
				cx - left + sx - 0.5,
				cy - top + sy - 0.5,
				data,
				(top + y - offsetY) * stride + (left + x - offsetX) * 4,
			);
		}
	}
}

/** バイリニア補間で 1 画素を取り出し、`out[offset..]` に書く。 */
function sample(
	source: Uint8ClampedArray,
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

	const i00 = (y0 * width + x0) * 4;
	const i10 = (y0 * width + x1) * 4;
	const i01 = (y1 * width + x0) * 4;
	const i11 = (y1 * width + x1) * 4;

	for (let channel = 0; channel < 4; channel++) {
		const top = source[i00 + channel]! * (1 - fx) + source[i10 + channel]! * fx;
		const bottom = source[i01 + channel]! * (1 - fx) + source[i11 + channel]! * fx;
		out[offset + channel] = top * (1 - fy) + bottom * fy;
	}
}

// --- wasm の読み込み ---

export type WarpExports = {
	memory: WebAssembly.Memory;
	frame: (len: number) => number;
	warp: (
		canvasWidth: number,
		canvasHeight: number,
		offsetX: number,
		offsetY: number,
		bufferWidth: number,
		bufferHeight: number,
		cx: number,
		cy: number,
		radius: number,
		mode: number,
		strength: number,
		dirX: number,
		dirY: number,
	) => void;
};

/**
 * wasm が要求するインポート。
 *
 * 三角関数と冪は Rust 側からこの `Math` を呼ぶ。JS 実装とまったく同じ関数を
 * 通ることになるので、実装ごとの最終桁の違いが原理的に出ない。
 */
export const WARP_IMPORTS = { Math: { pow: Math.pow, sin: Math.sin, cos: Math.cos } };

/**
 * バイト列からのインスタンス化。
 *
 * `worker-configuration.d.ts` が宣言する `WebAssembly` は workerd のもので、
 * 受け付けるのはバンドラが解決済みの `Module` だけ。実行時のコンパイルは
 * workerd が禁じているので型にも無い。ここはブラウザでしか動かないため、
 * ブラウザ側の形を名指しして通す。
 */
const instantiateBytes = WebAssembly.instantiate as unknown as (
	bytes: BufferSource,
	imports: typeof WARP_IMPORTS,
) => Promise<{ instance: { exports: unknown } }>;

let engine: WarpExports | null = null;
let started = false;

/**
 * 読み込み済みなら wasm を返す。まだなら読み込みを始めて null を返す。
 *
 * 待たない。歪みを 1 フレーム JS で描いてから wasm に切り替わっても結果は同じで、
 * 待つ側にした方がむしろ最初の 1 枚が遅れる。
 */
export function warpEngine(): WarpExports | null {
	if (engine) return engine;
	if (started) return null;
	started = true;

	// SSR とテストでは動かさない。Workers も workerd も、実行時に wasm を
	// コンパイルすること自体を許していない。
	if (typeof window === "undefined" || typeof WebAssembly === "undefined") return null;

	void (async () => {
		try {
			const response = await fetch(wasmUrl);
			const { instance } = await instantiateBytes(await response.arrayBuffer(), WARP_IMPORTS);
			engine = instance.exports as WarpExports;
		} catch {
			// 読めなくても JS 実装で同じ絵が出る。黙って諦めてよい。
		}
	})();

	return null;
}

/** テスト用。wasm を明示的に差し込む。 */
export function setWarpEngine(exports: WarpExports | null): void {
	engine = exports;
	started = true;
}
