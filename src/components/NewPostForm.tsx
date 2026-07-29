import { useRef, useState } from "react";

import type { Visibility } from "../agents/post/ops";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../lib/media";

/** 選択された画像と、そこから測ったアスペクト比・プレビュー URL。 */
type Picked = { file: File; aspectRatio: number; previewUrl: string };

const ACCEPT = Object.keys(ALLOWED_IMAGE_TYPES).join(",");
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

export default function NewPostForm({ friendCount }: { friendCount: number }) {
	// 既定はフレンドのみ。うっかり全世界に出るより、狭い方に倒す。
	const [visibility, setVisibility] = useState<Visibility>("friends");
	const [picked, setPicked] = useState<Picked | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");

	// プレビュー用の object URL。差し替えのたびに前のものを開放する。
	// （残った分は文書の破棄時にブラウザが回収するので、effect は要らない。）
	const previewUrlRef = useRef<string | null>(null);

	async function pick(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		setPicked(null);
		setError("");
		if (!file) return;

		if (file.size > MAX_UPLOAD_BYTES) {
			setError("画像が大きすぎます");
			return;
		}

		if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
		const previewUrl = URL.createObjectURL(file);
		previewUrlRef.current = previewUrl;

		try {
			// op は正規化座標なので、実座標に戻すのにアスペクト比が要る。
			const probe = await loadImage(previewUrl);
			setPicked({ file, previewUrl, aspectRatio: probe.naturalWidth / probe.naturalHeight });
		} catch {
			URL.revokeObjectURL(previewUrl);
			previewUrlRef.current = null;
			setError("画像を読み込めませんでした");
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
				headers: { "content-type": picked.file.type },
				body: picked.file,
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
			<label>
				画像（{MAX_MB}MB まで）
				<input type="file" name="image" accept={ACCEPT} onChange={pick} required />
			</label>
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

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to decode"));
		image.src = src;
	});
}

async function message(response: Response, fallback: string): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { message?: string } | null;
	return new Error(body?.message ?? fallback);
}
