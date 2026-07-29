/**
 * アイコンの差し替え。
 *
 * 元のファイルをそのまま送らず、中央を正方形に切って 256px の webp に落として
 * から上げる。アイコンは常に小さく丸く出るので、10MB の写真を保管しても意味が
 * ないし、一覧に並べたときの転送量にも効く。
 */

import { useRef, useState } from "react";

import { authClient } from "../lib/auth-client";
import { loadImage } from "../lib/image";
import { AVATAR_SIZE, AVATAR_TYPE, mediaUrl } from "../lib/media";

export default function AvatarForm({ current, name }: { current: string | null; name: string }) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const input = useRef<HTMLInputElement>(null);

	async function pick(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		setPending(true);
		setError("");

		try {
			const blob = await toSquareWebp(file);
			const upload = await fetch("/api/uploads?kind=avatar", {
				method: "POST",
				headers: { "content-type": AVATAR_TYPE },
				body: blob,
			});
			if (!upload.ok) {
				const failure = (await upload.json().catch(() => null)) as { message?: string } | null;
				throw new Error(failure?.message ?? "アップロードできませんでした");
			}
			const { key } = (await upload.json()) as { key: string };

			const { error: failure } = await authClient.updateUser({ image: key });
			if (failure) throw new Error(failure.message ?? "設定できませんでした");
			location.reload();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "設定できませんでした");
			setPending(false);
			if (input.current) input.current.value = "";
		}
	}

	async function clear() {
		setPending(true);
		setError("");
		const { error: failure } = await authClient.updateUser({ image: "" });
		if (failure) {
			setError(failure.message ?? "外せませんでした");
			setPending(false);
			return;
		}
		location.reload();
	}

	return (
		<div className="avatar-form">
			{current ? (
				<img className="avatar avatar-lg" src={mediaUrl(current)} alt="" />
			) : (
				<span className="avatar avatar-lg avatar-blank">{name.slice(0, 1)}</span>
			)}
			<div className="avatar-actions">
				<label className="file-button">
					{pending ? "処理中…" : current ? "変更する" : "アイコンを設定"}
					<input
						ref={input}
						type="file"
						accept="image/*"
						onChange={pick}
						disabled={pending}
						hidden
					/>
				</label>
				{current && (
					<button type="button" onClick={clear} disabled={pending}>
						外す
					</button>
				)}
				<p className="error">{error}</p>
			</div>
		</div>
	);
}

/** 中央を正方形に切り出して AVATAR_SIZE に縮め、webp にする。 */
async function toSquareWebp(file: File): Promise<Blob> {
	const url = URL.createObjectURL(file);
	try {
		const image = await loadImage(url);

		const side = Math.min(image.naturalWidth, image.naturalHeight);
		const canvas = document.createElement("canvas");
		canvas.width = AVATAR_SIZE;
		canvas.height = AVATAR_SIZE;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("画像を処理できませんでした");

		ctx.drawImage(
			image,
			(image.naturalWidth - side) / 2,
			(image.naturalHeight - side) / 2,
			side,
			side,
			0,
			0,
			AVATAR_SIZE,
			AVATAR_SIZE,
		);

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, AVATAR_TYPE, 0.9),
		);
		if (!blob) throw new Error("画像を変換できませんでした");
		return blob;
	} finally {
		URL.revokeObjectURL(url);
	}
}
