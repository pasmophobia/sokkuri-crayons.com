import { useState } from "react";

import { authClient } from "../lib/auth-client";

export default function ForgotPasswordForm() {
	const [pending, setPending] = useState(false);
	const [sent, setSent] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const email = String(new FormData(event.currentTarget).get("email") ?? "");
		setPending(true);

		await authClient.requestPasswordReset({
			email,
			redirectTo: `${location.origin}/reset-password`,
		});

		// 成否を問わず同じ表示にする。ここで出し分けると、
		// どのアドレスが登録済みかを誰でも確かめられてしまう。
		setSent(true);
		setPending(false);
	}

	if (sent) {
		return (
			<p className="muted">
				再設定用のリンクを送りました。メールが届かない場合、そのアドレスは登録されていないか、
				迷惑メールに振り分けられている可能性があります。
			</p>
		);
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				メールアドレス
				<input type="email" name="email" autoComplete="email" required />
			</label>
			<button className="primary" type="submit" disabled={pending}>
				{pending ? "送信中…" : "再設定リンクを送る"}
			</button>
			<p className="muted">
				<a href="/signin">ログインに戻る</a>
			</p>
		</form>
	);
}
