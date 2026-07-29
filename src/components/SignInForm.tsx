import { useState } from "react";

import { authClient } from "../lib/auth-client";

export default function SignInForm() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	/** 未確認で弾かれたアドレス。確認メールを送り直せるように覚えておく。 */
	const [unverified, setUnverified] = useState<string | null>(null);
	const [resent, setResent] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const email = String(form.get("email"));
		setPending(true);
		setError("");
		setUnverified(null);
		setResent(false);

		const { error: failure } = await authClient.signIn.email({
			email,
			password: String(form.get("password")),
		});

		if (failure) {
			if (failure.code === "EMAIL_NOT_VERIFIED") {
				setUnverified(email);
				setError("メールアドレスがまだ確認されていません。");
			} else {
				setError(failure.message ?? "ログインできませんでした");
			}
			setPending(false);
			return;
		}
		location.href = "/";
	}

	async function resend() {
		if (!unverified) return;
		setPending(true);
		await authClient.sendVerificationEmail({
			email: unverified,
			callbackURL: "/",
		});
		setResent(true);
		setPending(false);
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
			{unverified &&
				(resent ? (
					<p className="muted">確認メールを送り直しました。</p>
				) : (
					<button type="button" onClick={resend} disabled={pending}>
						確認メールを送り直す
					</button>
				))}
			<button className="primary" type="submit" disabled={pending}>
				{pending ? "ログイン中…" : "ログイン"}
			</button>
			<p className="muted">
				<a href="/forgot-password">パスワードを忘れた場合</a>
			</p>
			<p className="muted">
				アカウントがない場合は <a href="/signup">登録</a>。
			</p>
		</form>
	);
}
