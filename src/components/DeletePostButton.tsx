/**
 * 投稿の削除ボタン。投稿者にだけ出る。
 *
 * 確認は `confirm()` ではなくその場の 2 段階にしてある。落書きを重ねる
 * サービスなので、消せば他人が描いたものまで一緒に消える —— それを
 * 読ませてから押させたい。
 */

import { useState } from "react";

import { localePath, useTranslations, type Locale } from "../i18n";

export default function DeletePostButton({ locale, postId }: { locale: Locale; postId: string }) {
	const [confirming, setConfirming] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const t = useTranslations(locale);

	async function remove() {
		setPending(true);
		setError("");

		const response = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
		if (!response.ok) {
			const failure = (await response.json().catch(() => null)) as { message?: string } | null;
			setError(failure?.message ?? t("post.deleteFailed"));
			setPending(false);
			return;
		}
		// 消した投稿のページに留まっても 404 しかないので、一覧へ戻す。
		location.assign(localePath(locale, "/"));
	}

	if (!confirming) {
		return (
			<div className="post-actions">
				<button type="button" onClick={() => setConfirming(true)}>
					{t("post.delete")}
				</button>
			</div>
		);
	}

	return (
		<div className="post-actions">
			<p className="muted">{t("post.deleteWarning")}</p>
			<div className="actions">
				<button className="danger" type="button" disabled={pending} onClick={() => void remove()}>
					{pending ? t("post.deleting") : t("post.deleteConfirm")}
				</button>
				<button type="button" disabled={pending} onClick={() => setConfirming(false)}>
					{t("post.deleteCancel")}
				</button>
			</div>
			<p className="error">{error}</p>
		</div>
	);
}
