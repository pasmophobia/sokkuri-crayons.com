/**
 * アイコンの差し替え。
 *
 * 元のファイルをそのまま送らず、中央を正方形に切って 256px の webp に落として
 * から上げる。アイコンは常に小さく丸く出るので、10MB の写真を保管しても意味が
 * ないし、一覧に並べたときの転送量にも効く。
 */

import { useRef, useState } from "react";

import { useTranslations, type Locale, type Translate } from "../i18n";
import { authClient } from "../lib/auth-client";
import { ImageError, loadImage } from "../lib/image";
import { AVATAR_SIZE, AVATAR_TYPE, mediaUrl } from "../lib/media";

export default function AvatarForm({
	locale,
	current,
	name,
}: {
	locale: Locale;
	current: string | null;
	name: string;
}) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const t = useTranslations(locale);

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
				throw new Error(failure?.message ?? t("account.avatarUploadFailed"));
			}
			const { key } = (await upload.json()) as { key: string };

			const { error: failure } = await authClient.updateUser({ image: key });
			if (failure) throw new Error(failure.message ?? t("account.avatarSetFailed"));
			location.reload();
		} catch (failure) {
			setError(describe(failure, t, t("account.avatarSetFailed")));
			setPending(false);
			if (input.current) input.current.value = "";
		}
	}

	async function clear() {
		setPending(true);
		setError("");
		const { error: failure } = await authClient.updateUser({ image: "" });
		if (failure) {
			setError(failure.message ?? t("account.avatarClearFailed"));
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
					{pending
						? t("account.avatarPending")
						: current
							? t("account.avatarChange")
							: t("account.avatarSet")}
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
						{t("account.avatarClear")}
					</button>
				)}
				<p className="error">{error}</p>
			</div>
		</div>
	);
}

/** 例外を今の言語の一文にする。`ImageError` だけは鍵を持っているので引き直す。 */
function describe(failure: unknown, t: Translate, fallback: string): string {
	if (failure instanceof ImageError) return t(failure.key);
	return failure instanceof Error ? failure.message : fallback;
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
		if (!ctx) throw new ImageError("image.processFailed");

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
		if (!blob) throw new ImageError("image.convertFailed");
		return blob;
	} finally {
		URL.revokeObjectURL(url);
	}
}
