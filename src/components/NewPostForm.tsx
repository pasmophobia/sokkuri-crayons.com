import { useEffect, useRef, useState } from "react";

import type { Visibility } from "../agents/post/ops";
import { MAX_SOURCE_BYTES, fitForUpload, loadImage } from "../lib/image";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../lib/media";

/** アップロードする実体と、そこから測ったアスペクト比・プレビュー URL。 */
type Picked = { blob: Blob; type: string; aspectRatio: number; previewUrl: string };

const ACCEPT = Object.keys(ALLOWED_IMAGE_TYPES).join(",");
const MAX_MB = Math.round(MAX_SOURCE_BYTES / 1024 / 1024);

export default function NewPostForm({ friendCount }: { friendCount: number }) {
	// 既定はフレンドのみ。うっかり全世界に出るより、狭い方に倒す。
	const [visibility, setVisibility] = useState<Visibility>("friends");
	const [picked, setPicked] = useState<Picked | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [hasCamera, setHasCamera] = useState(false);

	// プレビュー用の object URL。差し替えのたびに前のものを開放する。
	// （残った分は文書の破棄時にブラウザが回収するので、effect は要らない。）
	const previewUrlRef = useRef<string | null>(null);

	useEffect(() => {
		// capture は PC のブラウザだと黙って無視され、ただのファイル選択になる。
		// 「カメラで撮る」と書いた口が写真フォルダを開くと戸惑うので、
		// カメラを構える端末 —— 指で触る画面 —— でだけ出す。
		//
		// 対応の有無は属性からは分からない（Chromium は capture を効かせるのに
		// IDL プロパティを生やさない）ので、入力装置で見分けている。
		setHasCamera(window.matchMedia("(pointer: coarse)").matches);
	}, []);

	async function pick(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		// 同じ写真を撮り直したときにも change が飛ぶようにしておく。
		event.target.value = "";
		setPicked(null);
		setError("");
		if (!file) return;

		if (file.size > MAX_SOURCE_BYTES) {
			setError("画像が大きすぎます");
			return;
		}

		if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
		const previewUrl = URL.createObjectURL(file);
		previewUrlRef.current = previewUrl;

		setPending(true);
		try {
			// op は正規化座標なので、実座標に戻すのにアスペクト比が要る。
			const probe = await loadImage(previewUrl);
			const { blob, type } = await fitForUpload(file, probe);
			// 縮めてもなお収まらないもの（動く gif など）は、送る前に断る。
			if (blob.size > MAX_UPLOAD_BYTES) throw new Error("画像が大きすぎます");
			setPicked({
				blob,
				type,
				previewUrl,
				aspectRatio: probe.naturalWidth / probe.naturalHeight,
			});
		} catch (failure) {
			URL.revokeObjectURL(previewUrl);
			previewUrlRef.current = null;
			setError(failure instanceof Error ? failure.message : "画像を読み込めませんでした");
		} finally {
			setPending(false);
		}
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!picked) return;
		const caption = String(new FormData(event.currentTarget).get("caption") ?? "");

		setPending(true);
		setError("アップロード中…");

		try {
			// 1. 実体を R2 に上げてキーをもらう
			const upload = await fetch("/api/uploads", {
				method: "POST",
				headers: { "content-type": picked.type },
				body: picked.blob,
			});
			if (!upload.ok) throw await message(upload, "アップロードできませんでした");
			const { key } = (await upload.json()) as { key: string };

			// 2. そのキーで投稿レコードを作る
			setError("投稿中…");
			const created = await fetch("/api/posts", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					imageKey: key,
					aspectRatio: picked.aspectRatio,
					caption,
					visibility,
				}),
			});
			if (!created.ok) throw await message(created, "投稿できませんでした");

			const { id } = (await created.json()) as { id: string };
			location.href = `/posts/${id}`;
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "投稿できませんでした");
			setPending(false);
		}
	}

	return (
		<form className="form" onSubmit={submit}>
			<div className="field">
				<span>画像</span>
				<div className="pick-actions">
					{hasCamera && (
						<label className="file-button">
							カメラで撮る
							<input
								type="file"
								accept={ACCEPT}
								capture="environment"
								onChange={pick}
								disabled={pending}
								hidden
							/>
						</label>
					)}
					<label className="file-button">
						{hasCamera ? "写真を選ぶ" : "画像を選ぶ"}
						<input type="file" accept={ACCEPT} onChange={pick} disabled={pending} hidden />
					</label>
				</div>
				<p className="muted">大きい写真は縮めて送ります（{MAX_MB}MB まで）。</p>
			</div>
			<label>
				キャプション
				<textarea name="caption" rows={3} maxLength={280} />
			</label>
			<label>
				公開範囲
				<select
					value={visibility}
					onChange={(event) => setVisibility(event.target.value as Visibility)}
				>
					<option value="friends">フレンドのみ</option>
					<option value="public">全体公開</option>
				</select>
			</label>
			{visibility === "friends" && friendCount === 0 && (
				<p className="muted">
					いまフレンドがいないので、この投稿は自分だけが見られます。
					<a href="/friends">フレンドを追加</a>すると共有されます。
				</p>
			)}
			<p className="error">{error}</p>
			{picked && <img className="preview" src={picked.previewUrl} alt="" />}
			<button className="primary" type="submit" disabled={!picked || pending}>
				投稿する
			</button>
			<p className="muted">
				{visibility === "public"
					? "投稿すると、誰でもこの画像に落書きや歪みを加えられます。"
					: "フレンドだけが閲覧でき、落書きや歪みを加えられます。"}
			</p>
		</form>
	);
}

async function message(response: Response, fallback: string): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { message?: string } | null;
	return new Error(body?.message ?? fallback);
}
