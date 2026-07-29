import { useState } from "react";

import { localePath, splitAroundLink, useTranslations, type Locale } from "../i18n";
import { authClient } from "../lib/auth-client";

export default function SignInForm({ locale }: { locale: Locale }) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	/** 未確認で弾かれたアドレス。確認メールを送り直せるように覚えておく。 */
	const [unverified, setUnverified] = useState<string | null>(null);
	const [resent, setResent] = useState(false);

	const t = useTranslations(locale);
	const [toSignUpBefore, toSignUpAfter] = splitAroundLink(t("signIn.toSignUp"));

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
				setError(t("signIn.unverified"));
			} else {
				setError(failure.message ?? t("signIn.failed"));
			}
			setPending(false);
			return;
		}
		location.href = localePath(locale, "/");
	}

	async function resend() {
		if (!unverified) return;
		setPending(true);
		await authClient.sendVerificationEmail({
			email: unverified,
			callbackURL: localePath(locale, "/"),
		});
		setResent(true);
		setPending(false);
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				{t("signIn.email")}
				<input type="email" name="email" autoComplete="email" required />
			</label>
			<label>
				{t("signIn.password")}
				<input type="password" name="password" autoComplete="current-password" required />
			</label>
			<p className="error">{error}</p>
			{unverified &&
				(resent ? (
					<p className="muted">{t("signIn.resent")}</p>
				) : (
					<button type="button" onClick={resend} disabled={pending}>
						{t("signIn.resend")}
					</button>
				))}
			<button className="primary" type="submit" disabled={pending}>
				{pending ? t("signIn.pending") : t("signIn.submit")}
			</button>
			<p className="muted">
				<a href={localePath(locale, "/forgot-password")}>{t("signIn.forgot")}</a>
			</p>
			<p className="muted">
				{toSignUpBefore}
				<a href={localePath(locale, "/signup")}>{t("nav.signUp")}</a>
				{toSignUpAfter}
			</p>
		</form>
	);
}
