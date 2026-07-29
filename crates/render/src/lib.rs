//! ディスプレイスメント（画素の歪み）を焼く WASM 側の実装。
//!
//! `src/lib/render.ts` の JS 実装と 1 対 1 に対応する。歪みは「その時点までに
//! 描かれた内容」を読み戻して書き直す処理なので、キャンバス経由でやると点ごとに
//! `getImageData` / `putImageData` が要る。ここでは JS から RGBA を一度だけ
//! 渡してもらい、連続する点をまとめてこのメモリ上で処理する。
//!
//! 線と文字は Canvas2D に残す。アンチエイリアスと合成モードとフォントの結果まで
//! 一致させるのは無理なので、画素演算だけを持ってくる。
//!
//! 座標系は 2 つある。`cx` / `cy` や効果範囲はキャンバス実座標。バッファは
//! JS が読み出した矩形 (`off_x`, `off_y`, `buf_w`, `buf_h`) ぶんしか無いので、
//! 添字を作るときにその原点を引く。

use std::f64::consts::PI;

/// swirl の最大回転量。JS 側の `MAX_SWIRL` と同じ。
const MAX_SWIRL: f64 = PI;

const SWIRL: i32 = 0;
const SMUDGE: i32 = 1;
const BULGE: i32 = 2;
const PINCH: i32 = 3;

const PAGE: usize = 65536;

extern "C" {
    /// リンカが置く、静的データの終わり。ここから上は自由に使ってよい。
    static __heap_base: u8;
}

// 三角関数と冪は JS の `Math` を借りる。
//
// 理由は 2 つある。1 つは一致。JS 実装と同じ関数を呼ぶので、実装ごとの
// 最終桁の違いが原理的に出ない。もう 1 つは速さ。Rust 標準の `powf` は
// libm ごと wasm に入るうえ、bulge / pinch では JS より 1.5 倍遅かった。
// 借りる側に倒すと wasm は 15KB から 4.7KB に減り、しかも速くなる。
#[link(wasm_import_module = "Math")]
extern "C" {
    fn pow(x: f64, y: f64) -> f64;
    fn sin(x: f64) -> f64;
    fn cos(x: f64) -> f64;
}

/// 線形メモリを `__heap_base + bytes` まで広げ、使ってよい領域の先頭を返す。
///
/// アロケータは持たない。要るのは「毎フレーム作り直す 2 つの連続領域」だけで、
/// 解放も再利用もしないので、伸ばしっぱなしで足りる。dlmalloc を積まない分
/// wasm も小さくなる。
fn reserve(bytes: usize) -> usize {
    let base = core::ptr::addr_of!(__heap_base) as usize;
    let have = core::arch::wasm32::memory_size(0) * PAGE;
    let want = base + bytes;
    if want > have {
        core::arch::wasm32::memory_grow(0, (want - have).div_ceil(PAGE));
    }
    base
}

/// RGBA を受け渡すバッファを `len` バイト以上にし、先頭を返す。
///
/// 伸長で `memory.grow` が起きると JS 側の `ArrayBuffer` は切り離される。
/// 先頭は動かないが、ビューは毎回作り直すこと。
#[no_mangle]
pub extern "C" fn frame(len: usize) -> *mut u8 {
    reserve(len) as *mut u8
}

/// 中心 (cx, cy) 半径 radius の円内を歪ませる。バッファを直接書き換える。
///
/// `dir_x` / `dir_y` は smudge の引きずり方向（正規化済み）。他のモードでは見ない。
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn warp(
    canvas_w: i32,
    canvas_h: i32,
    off_x: i32,
    off_y: i32,
    buf_w: i32,
    buf_h: i32,
    cx: f64,
    cy: f64,
    radius: f64,
    mode: i32,
    strength: f64,
    dir_x: f64,
    dir_y: f64,
) {
    // JS 版の warpDisc と同じ切り出し方。キャンバスからはみ出した分は捨てる。
    let left = (cx - radius).floor().max(0.0) as i32;
    let top = (cy - radius).floor().max(0.0) as i32;
    let right = (cx + radius).ceil().min(canvas_w as f64) as i32;
    let bottom = (cy + radius).ceil().min(canvas_h as f64) as i32;
    let box_w = right - left;
    let box_h = bottom - top;
    if box_w <= 0 || box_h <= 0 {
        return;
    }

    // 効果範囲は JS が渡した矩形に収まっているはず。念のため、外れていたら何もしない。
    if left < off_x || top < off_y || right > off_x + buf_w || bottom > off_y + buf_h {
        return;
    }

    let frame_len = (buf_w as usize) * (buf_h as usize) * 4;
    let scratch_len = (box_w as usize) * (box_h as usize) * 4;
    let base = reserve(frame_len + scratch_len);
    let frame = unsafe { std::slice::from_raw_parts_mut(base as *mut u8, frame_len) };
    let scratch =
        unsafe { std::slice::from_raw_parts_mut((base + frame_len) as *mut u8, scratch_len) };

    // 歪みは「歪ませる前の画素」を読む。書き戻しと読み出しが混ざらないよう退避する。
    let stride = (buf_w as usize) * 4;
    for y in 0..box_h as usize {
        let from = ((top as usize + y) - off_y as usize) * stride + (left - off_x) as usize * 4;
        let into = y * (box_w as usize) * 4;
        scratch[into..into + (box_w as usize) * 4]
            .copy_from_slice(&frame[from..from + (box_w as usize) * 4]);
    }

    for y in 0..box_h {
        for x in 0..box_w {
            let dx = (left + x) as f64 + 0.5 - cx;
            let dy = (top + y) as f64 + 0.5 - cy;
            let distance = (dx * dx + dy * dy).sqrt();
            if distance >= radius {
                continue;
            }

            // 効果は中心で最大、縁でゼロ。
            let t = distance / radius;
            let falloff = 1.0 - t;
            let (sx, sy) = match mode {
                SWIRL => {
                    let angle = -strength * MAX_SWIRL * falloff;
                    // SAFETY: JS から渡された Math.cos / Math.sin。
                    let (cos, sin) = unsafe { (cos(angle), sin(angle)) };
                    (dx * cos - dy * sin, dx * sin + dy * cos)
                }
                SMUDGE => {
                    let shift = strength * radius * 0.5 * falloff;
                    (dx - dir_x * shift, dy - dir_y * shift)
                }
                BULGE | PINCH => {
                    // 出力側の距離を入力側に引き戻す。指数 > 1 で中心が拡大される。
                    let signed = if mode == PINCH { -strength } else { strength };
                    let exponent = 1.0 + signed;
                    if t == 0.0 {
                        (0.0, 0.0)
                    } else {
                        // SAFETY: JS から渡された Math.pow。
                        let scale = unsafe { pow(t, exponent) } / t;
                        (dx * scale, dy * scale)
                    }
                }
                _ => continue,
            };

            let offset = ((top + y - off_y) as usize) * stride + ((left + x - off_x) as usize) * 4;
            sample(
                scratch,
                box_w,
                box_h,
                cx - left as f64 + sx - 0.5,
                cy - top as f64 + sy - 0.5,
                frame,
                offset,
            );
        }
    }
}

/// バイリニア補間で 1 画素を取り出し、`out[offset..]` に書く。
fn sample(source: &[u8], width: i32, height: i32, x: f64, y: f64, out: &mut [u8], offset: usize) {
    let clamped_x = x.min(width as f64 - 1.0).max(0.0);
    let clamped_y = y.min(height as f64 - 1.0).max(0.0);
    let x0 = clamped_x.floor() as i32;
    let y0 = clamped_y.floor() as i32;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let fx = clamped_x - x0 as f64;
    let fy = clamped_y - y0 as f64;

    let i00 = ((y0 * width + x0) * 4) as usize;
    let i10 = ((y0 * width + x1) * 4) as usize;
    let i01 = ((y1 * width + x0) * 4) as usize;
    let i11 = ((y1 * width + x1) * 4) as usize;

    for channel in 0..4 {
        let top = source[i00 + channel] as f64 * (1.0 - fx) + source[i10 + channel] as f64 * fx;
        let bottom = source[i01 + channel] as f64 * (1.0 - fx) + source[i11 + channel] as f64 * fx;
        out[offset + channel] = to_uint8_clamped(top * (1.0 - fy) + bottom * fy);
    }
}

/// `Uint8ClampedArray` への代入と同じ丸め方。0..255 に切り詰め、境目は偶数側へ。
fn to_uint8_clamped(value: f64) -> u8 {
    if !(value > 0.0) {
        return 0;
    }
    if value >= 255.0 {
        return 255;
    }
    value.round_ties_even() as u8
}
