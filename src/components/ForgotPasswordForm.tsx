import { useState } from "react";

import { localePath, useTranslations, type Locale } from "../i18n";
import { authClient } from "../lib/auth-client";

export default function ForgotPasswordForm({ locale }: { locale: Locale }) {
	const [pending, setPending] = useState(false);
	const [sent, setSent] = useState(false);
	const t = useTranslations(locale);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const email = String(new FormData(event.currentTarget).get("email") ?? "");
		setPending(true);

		await authClient.requestPasswordReset({
			email,
			// 再設定ページも今の言語で開く。
			redirectTo: `${location.origin}${localePath(locale, "/reset-password")}`,
		});

		// 成否を問わず同じ表示にする。ここで出し分けると、
		// どのアドレスが登録済みかを誰でも確かめられてしまう。
		setSent(true);
		setPending(false);
	}

	if (sent) {
		return <p className="muted">{t("forgot.sent")}</p>;
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				{t("forgot.email")}
				<input type="email" name="email" autoComplete="email" required />
			</label>
			<button className="primary" type="submit" disabled={pending}>
				{pending ? t("forgot.pending") : t("forgot.submit")}
			</button>
			<p className="muted">
				<a href={localePath(locale, "/signin")}>{t("forgot.backToSignIn")}</a>
			</p>
		</form>
	);
}
