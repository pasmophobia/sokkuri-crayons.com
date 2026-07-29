import { useState } from "react";

import { authClient } from "../lib/auth-client";

export default function SignUpForm() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [sent, setSent] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setPending(true);
		setError("");

		const { error: failure } = await authClient.signUp.email({
			name: String(form.get("name")),
			email: String(form.get("email")),
			password: String(form.get("password")),
			username: String(form.get("username")).trim().replace(/^@+/, ""),
		});

		if (failure) {
			setError(failure.message ?? "登録できませんでした");
			setPending(false);
			return;
		}
		// 確認メールを踏むまでログインできないので、ここでは移動しない。
		setSent(true);
		setPending(false);
	}

	if (sent) {
		return (
			<p className="muted">
				確認メールを送りました。本文のリンクを開くとアカウントが有効になります。
			</p>
		);
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				表示名
				<input type="text" name="name" autoComplete="nickname" maxLength={40} required />
			</label>
			<label>
				ユーザー名（英数字と _、3〜20 文字）
				<input
					type="text"
					name="username"
					autoComplete="username"
					minLength={3}
					maxLength={20}
					pattern="@?[A-Za-z0-9_]+"
					required
				/>
			</label>
			<label>
				メールアドレス（ログイン用）
				<input type="email" name="email" autoComplete="email" required />
			</label>
			<label>
				パスワード（8 文字以上）
				<input type="password" name="password" autoComplete="new-password" minLength={8} required />
			</label>
			<p className="error">{error}</p>
			<button className="primary" type="submit" disabled={pending}>
				{pending ? "登録中…" : "登録する"}
			</button>
			<p className="muted">
				登録済みの場合は <a href="/signin">ログイン</a>。
			</p>
		</form>
	);
}
