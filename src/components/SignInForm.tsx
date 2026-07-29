import { useState } from "react";

import { authClient } from "../lib/auth-client";

export default function SignInForm() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setPending(true);
		setError("");

		const { error: failure } = await authClient.signIn.email({
			email: String(form.get("email")),
			password: String(form.get("password")),
		});

		if (failure) {
			setError(failure.message ?? "ログインできませんでした");
			setPending(false);
			return;
		}
		location.href = "/";
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				メールアドレス
				<input type="email" name="email" autoComplete="email" required />
			</label>
			<label>
				パスワード
				<input type="password" name="password" autoComplete="current-password" required />
			</label>
			<p className="error">{error}</p>
			<button className="primary" type="submit" disabled={pending}>
				{pending ? "ログイン中…" : "ログイン"}
			</button>
			<p className="muted">
				アカウントがない場合は <a href="/signup">登録</a>。
			</p>
		</form>
	);
}
