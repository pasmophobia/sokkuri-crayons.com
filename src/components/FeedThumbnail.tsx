/**
 * 一覧 1 枚ぶんのサムネイル。
 *
 * サーバでは焼かない。Workers に Canvas が無いので、焼くとしたら誰かのブラウザに
 * 任せるしかなく、その中身が本当にキャンバスと一致しているかをサーバは検証できない。
 * 実際それで、画像が載る前に焼かれた壊れたサムネイルが「新しい」扱いで居座った。
 *
 * ここでは op をその場で描く。常に最新で、壊れて残ることもない。
 * ハイドレーションは `client:visible` に任せているので、画面に入った分だけが
 * 取得と描画を行う。
 */

import { useCallback, useRef, useState } from "react";

import type { CommittedOp } from "../agents/post/ops";
import { renderPost } from "../lib/render";

type Props = {
	postId: string;
	imageUrl: string;
	aspectRatio: number;
	caption: string;
};

/**
 * 描画幅。表示幅（1 カラムで約 600px）より少し大きく取り、高精細ディスプレイでも
 * 眠くならない程度にする。歪みは画素単位で効くので上げすぎない。
 */
const THUMBNAIL_WIDTH = 960;

export default function FeedThumbnail({ postId, imageUrl, aspectRatio, caption }: Props) {
	const [drawn, setDrawn] = useState(false);
	const cancelled = useRef(false);

	// canvas が現れた時点で描き始める。要素が要るだけなので useEffect は挟まない。
	const mount = useCallback(
		(canvas: HTMLCanvasElement | null) => {
			if (!canvas) return;
			cancelled.current = false;

			void draw(canvas, postId, imageUrl, aspectRatio, cancelled).then((ok) => {
				if (ok && !cancelled.current) setDrawn(true);
			});

			return () => {
				cancelled.current = true;
			};
		},
		[postId, imageUrl, aspectRatio],
	);

	return (
		<div className="thumb" style={{ aspectRatio }}>
			{/* 描き上がるまで（および JS が動かない場合）は元画像を見せる。 */}
			<img src={imageUrl} alt={caption} loading="lazy" hidden={drawn} />
			<canvas ref={mount} hidden={!drawn} />
		</div>
	);
}

async function draw(
	canvas: HTMLCanvasElement,
	postId: string,
	imageUrl: string,
	aspectRatio: number,
	cancelled: { current: boolean },
): Promise<boolean> {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return false;

	canvas.width = THUMBNAIL_WIDTH;
	canvas.height = Math.round(THUMBNAIL_WIDTH / (aspectRatio || 1));

	try {
		const [image, ops] = await Promise.all([loadImage(imageUrl), fetchOps(postId)]);
		if (cancelled.current) return false;
		renderPost(ctx, image, ops);
		return true;
	} catch {
		// 元画像の <img> がそのまま残るだけなので、黙って諦めてよい。
		return false;
	}
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		// 歪みは getImageData で読み戻すため、汚染されたキャンバスでは描けない。
		image.crossOrigin = "anonymous";
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to load image"));
		image.src = src;
	});
}

async function fetchOps(postId: string): Promise<CommittedOp[]> {
	const response = await fetch(`/api/posts/${postId}/ops`);
	if (!response.ok) throw new Error(`ops request failed: ${response.status}`);
	const body = (await response.json()) as { ops: CommittedOp[] };
	return body.ops;
}
