/**
 * wasm と JS、2 つの歪み実装を突き合わせる。
 *
 * 速いだけで結果が変われば、それは別の絵になる。この 2 つは同じ引数で同じ画素を
 * 返さなければならず、ここが両者をつなぐ唯一の保証になっている。
 *
 * workerd は実行時に wasm をコンパイルさせないので、本番と違って
 * `WebAssembly.Module` としてバンドラに解決させる。試すのは中身の演算なので、
 * 読み込み方が違っても差し支えない。
 */

import { beforeEach, describe, expect, it } from "vitest";

import wasmModule from "../wasm/render.wasm";
import {
	runWarps,
	setWarpEngine,
	warpBounds,
	warpJs,
	WARP_IMPORTS,
	WARP_MODE,
	type WarpCall,
	type WarpExports,
} from "./warp";

const instance = new WebAssembly.Instance(wasmModule, WARP_IMPORTS);
const exports = instance.exports as unknown as WarpExports;

const WIDTH = 61;
const HEIGHT = 47;

/** 固定の種から作る。差が出たときに必ず同じ入力で再現できるようにする。 */
function noise(seed: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
	let state = seed >>> 0;
	for (let index = 0; index < data.length; index++) {
		state = (state * 1664525 + 1013904223) >>> 0;
		// アルファは 255 のまま。キャンバスは不透明な元画像で埋まっている。
		data[index] = index % 4 === 3 ? 255 : state >>> 24;
	}
	return data;
}

function byJs(data: Uint8ClampedArray, calls: WarpCall[]): Uint8ClampedArray {
	const out = data.slice();
	for (const call of calls) warpJs(out, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT, call);
	return out;
}

function byWasm(data: Uint8ClampedArray, calls: WarpCall[]): Uint8ClampedArray {
	const out = data.slice();
	setWarpEngine(exports);
	try {
		runWarps(out, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT, calls);
	} finally {
		setWarpEngine(null);
	}
	return out;
}

function call(overrides: Partial<WarpCall> = {}): WarpCall {
	return {
		cx: 30.5,
		cy: 23.5,
		radius: 12,
		mode: WARP_MODE.swirl,
		strength: 0.6,
		dirX: 0,
		dirY: 0,
		...overrides,
	};
}

beforeEach(() => setWarpEngine(null));

describe("warpBounds", () => {
	it("キャンバスからはみ出したぶんを切り落とす", () => {
		expect(warpBounds(call({ cx: 2, cy: 2, radius: 10 }), WIDTH, HEIGHT)).toEqual({
			left: 0,
			top: 0,
			right: 12,
			bottom: 12,
		});
	});

	it("キャンバスの外なら null", () => {
		expect(warpBounds(call({ cx: -20, cy: 10, radius: 5 }), WIDTH, HEIGHT)).toBeNull();
	});
});

describe("wasm と JS が同じ画素を返す", () => {
	const cases: { name: string; calls: WarpCall[] }[] = [
		{ name: "swirl", calls: [call({ mode: WARP_MODE.swirl, strength: 0.8 })] },
		{ name: "swirl（逆向き）", calls: [call({ mode: WARP_MODE.swirl, strength: -0.45 })] },
		{
			name: "smudge",
			calls: [call({ mode: WARP_MODE.smudge, strength: 0.7, dirX: 0.6, dirY: -0.8 })],
		},
		{ name: "bulge", calls: [call({ mode: WARP_MODE.bulge, strength: 0.5 })] },
		{ name: "pinch", calls: [call({ mode: WARP_MODE.pinch, strength: 0.9 })] },
		{ name: "強さ 0", calls: [call({ mode: WARP_MODE.bulge, strength: 0 })] },
		{
			name: "半径が画像より大きい",
			calls: [call({ mode: WARP_MODE.swirl, radius: 200, strength: 0.3 })],
		},
		{
			// 効果範囲がキャンバスの縁で切れると、はみ出した先の画素は端で
			// 引き伸ばされる。切り方まで一致していないとここで差が出る。
			name: "四隅にかかる",
			calls: [
				call({ cx: 0.5, cy: 0.5, radius: 9, mode: WARP_MODE.bulge, strength: 0.7 }),
				call({ cx: WIDTH - 0.5, cy: 0.5, radius: 9, mode: WARP_MODE.pinch, strength: 0.7 }),
				call({ cx: 0.5, cy: HEIGHT - 0.5, radius: 9, mode: WARP_MODE.swirl, strength: 0.7 }),
				call({
					cx: WIDTH - 0.5,
					cy: HEIGHT - 0.5,
					radius: 9,
					mode: WARP_MODE.smudge,
					strength: 0.7,
					dirX: 1,
					dirY: 0,
				}),
			],
		},
		{
			// 1 本のストロークぶん。前の点の結果を次の点が読むので、
			// 順番が入れ替われば結果も変わる。
			name: "連続する点",
			calls: Array.from({ length: 24 }, (_unused, index) =>
				call({
					cx: 6 + index * 2,
					cy: 10 + Math.sin(index / 3) * 8,
					radius: 7,
					mode: WARP_MODE.smudge,
					strength: 0.55,
					dirX: 1,
					dirY: 0,
				}),
			),
		},
	];

	for (const { name, calls } of cases) {
		it(name, () => {
			const data = noise(0x5eed);
			expect(Array.from(byWasm(data, calls))).toEqual(Array.from(byJs(data, calls)));
		});
	}

	it("4 つのモードを混ぜても順番どおりに効く", () => {
		const modes = [WARP_MODE.swirl, WARP_MODE.smudge, WARP_MODE.bulge, WARP_MODE.pinch];
		const calls = Array.from({ length: 40 }, (_unused, index) =>
			call({
				cx: 4 + ((index * 7) % (WIDTH - 8)),
				cy: 4 + ((index * 11) % (HEIGHT - 8)),
				radius: 4 + (index % 5) * 2,
				mode: modes[index % modes.length]!,
				strength: -0.9 + (index % 19) * 0.1,
				dirX: Math.cos(index),
				dirY: Math.sin(index),
			}),
		);
		const data = noise(0xc0ffee);
		expect(Array.from(byWasm(data, calls))).toEqual(Array.from(byJs(data, calls)));
	});
});

describe("runWarps", () => {
	it("wasm が無ければ JS で同じ結果を出す", () => {
		const calls = [call({ mode: WARP_MODE.bulge, strength: 0.4 })];
		const data = noise(0x1234);

		const viaRunWarps = data.slice();
		runWarps(viaRunWarps, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT, calls);

		expect(Array.from(viaRunWarps)).toEqual(Array.from(byJs(data, calls)));
	});

	it("キャンバスの一部だけを渡しても、全体を渡したときと同じになる", () => {
		// レンダラは効果範囲を囲む矩形しか読み出さない。原点をずらしたバッファでも
		// キャンバス座標で切り出せていることを確かめる。
		const calls = [call({ cx: 30.5, cy: 23.5, radius: 8, mode: WARP_MODE.swirl, strength: 0.6 })];
		const data = noise(0xabcd);

		const whole = byWasm(data, calls);

		const left = 20;
		const top = 14;
		const boxWidth = 22;
		const boxHeight = 20;
		const part = new Uint8ClampedArray(boxWidth * boxHeight * 4);
		for (let y = 0; y < boxHeight; y++) {
			const from = ((top + y) * WIDTH + left) * 4;
			part.set(data.subarray(from, from + boxWidth * 4), y * boxWidth * 4);
		}

		setWarpEngine(exports);
		try {
			runWarps(part, WIDTH, HEIGHT, left, top, boxWidth, boxHeight, calls);
		} finally {
			setWarpEngine(null);
		}

		for (let y = 0; y < boxHeight; y++) {
			const from = ((top + y) * WIDTH + left) * 4;
			expect(Array.from(part.subarray(y * boxWidth * 4, (y + 1) * boxWidth * 4))).toEqual(
				Array.from(whole.subarray(from, from + boxWidth * 4)),
			);
		}
	});
});
