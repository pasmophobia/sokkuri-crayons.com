import { useState } from "react";

import { authClient } from "../lib/auth-client";

/**
 * ユーザー名の設定・変更。
 * ユーザー名を持たない既存アカウントを救済するためにも要る。
 */
export default function UsernameForm({ current }: { current: string | null }) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		// 他所から `@name` の形で貼られても通るようにする。
		const username = String(new FormData(event.currentTarget).get("username") ?? "")
			.trim()
			.replace(/^@+/, "");
		setPending(true);
		setError("");

		// displayUsername も一緒に送る。username だけだと正規化後の小文字しか
		// 残らず、入力どおりの大小が失われる。
		const { error: failure } = await authClient.updateUser({
			username,
			displayUsername: username,
		});
		if (failure) {
			setError(failure.message ?? "設定できませんでした（すでに使われている可能性があります）");
			setPending(false);
			return;
		}
		location.reload();
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				ユーザー名（英数字と _、3〜20 文字）
				<input
					type="text"
					name="username"
					defaultValue={current ?? ""}
					minLength={3}
					maxLength={20}
					pattern="@?[A-Za-z0-9_]+"
					required
				/>
			</label>
			<p className="error">{error}</p>
			<button className="primary" type="submit" disabled={pending}>
				{current ? "変更する" : "設定する"}
			</button>
		</form>
	);
}
