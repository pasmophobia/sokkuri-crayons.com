import { useState } from "react";

import { localePath, splitAroundLink, useTranslations, type Locale } from "../i18n";
import { authClient } from "../lib/auth-client";

export default function SignUpForm({ locale }: { locale: Locale }) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [sent, setSent] = useState(false);

	const t = useTranslations(locale);
	const [toSignInBefore, toSignInAfter] = splitAroundLink(t("signUp.toSignIn"));

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
			setError(failure.message ?? t("signUp.failed"));
			setPending(false);
			return;
		}
		// 確認メールを踏むまでログインできないので、ここでは移動しない。
		setSent(true);
		setPending(false);
	}

	if (sent) {
		return <p className="muted">{t("signUp.sent")}</p>;
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				{t("signUp.name")}
				<input type="text" name="name" autoComplete="nickname" maxLength={40} required />
			</label>
			<label>
				{t("signUp.username")}
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
				{t("signUp.email")}
				<input type="email" name="email" autoComplete="email" required />
			</label>
			<label>
				{t("signUp.password")}
				<input type="password" name="password" autoComplete="new-password" minLength={8} required />
			</label>
			<p className="error">{error}</p>
			<button className="primary" type="submit" disabled={pending}>
				{pending ? t("signUp.pending") : t("signUp.submit")}
			</button>
			<p className="muted">
				{toSignInBefore}
				<a href={localePath(locale, "/signin")}>{t("nav.signIn")}</a>
				{toSignInAfter}
			</p>
		</form>
	);
}
