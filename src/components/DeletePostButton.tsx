/**
 * 投稿の削除ボタン。投稿者にだけ出る。
 *
 * 確認は `confirm()` ではなくその場の 2 段階にしてある。落書きを重ねる
 * サービスなので、消せば他人が描いたものまで一緒に消える —— それを
 * 読ませてから押させたい。
 */

import { useState } from "react";

export default function DeletePostButton({ postId }: { postId: string }) {
	const [confirming, setConfirming] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");

	async function remove() {
		setPending(true);
		setError("");

		const response = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
		if (!response.ok) {
			const failure = (await response.json().catch(() => null)) as { message?: string } | null;
			setError(failure?.message ?? "削除できませんでした");
			setPending(false);
			return;
		}
		// 消した投稿のページに留まっても 404 しかないので、一覧へ戻す。
		location.assign("/");
	}

	if (!confirming) {
		return (
			<div className="post-actions">
				<button type="button" onClick={() => setConfirming(true)}>
					削除
				</button>
			</div>
		);
	}

	return (
		<div className="post-actions">
			<p className="muted">
				この投稿を削除します。重ねられた落書きもまとめて消え、元には戻せません。
			</p>
			<div className="actions">
				<button className="danger" type="button" disabled={pending} onClick={() => void remove()}>
					{pending ? "削除中…" : "削除する"}
				</button>
				<button type="button" disabled={pending} onClick={() => setConfirming(false)}>
					やめる
				</button>
			</div>
			<p className="error">{error}</p>
		</div>
	);
}
