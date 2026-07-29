import { useState } from "react";

import { authClient } from "../lib/auth-client";

export default function ResetPasswordForm({ token }: { token: string | null }) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");

	if (!token) {
		return (
			<p className="muted">
				リンクが正しくないか、期限が切れています。
				<a href="/forgot-password">もう一度送り直して</a>ください。
			</p>
		);
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const newPassword = String(new FormData(event.currentTarget).get("newPassword") ?? "");
		setPending(true);
		setError("");

		const { error: failure } = await authClient.resetPassword({ newPassword, token: token! });
		if (failure) {
			setError(
				failure.message ?? "再設定できませんでした。リンクの期限が切れているかもしれません。",
			);
			setPending(false);
			return;
		}
		location.href = "/signin?reset=1";
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				新しいパスワード（8 文字以上）
				<input
					type="password"
					name="newPassword"
					autoComplete="new-password"
					minLength={8}
					required
				/>
			</label>
			<p className="error">{error}</p>
			<button className="primary" type="submit" disabled={pending}>
				{pending ? "設定中…" : "この内容で設定する"}
			</button>
		</form>
	);
}
