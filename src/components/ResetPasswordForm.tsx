import { useState } from "react";

import { localePath, splitAroundLink, useTranslations, type Locale } from "../i18n";
import { authClient } from "../lib/auth-client";

export default function ResetPasswordForm({
	locale,
	token,
}: {
	locale: Locale;
	token: string | null;
}) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const t = useTranslations(locale);

	if (!token) {
		const [before, after] = splitAroundLink(t("reset.badToken"));
		return (
			<p className="muted">
				{before}
				<a href={localePath(locale, "/forgot-password")}>{t("reset.badTokenLink")}</a>
				{after}
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
			setError(failure.message ?? t("reset.failed"));
			setPending(false);
			return;
		}
		location.href = `${localePath(locale, "/signin")}?reset=1`;
	}

	return (
		<form className="form" onSubmit={submit}>
			<label>
				{t("reset.password")}
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
				{pending ? t("reset.pending") : t("reset.submit")}
			</button>
		</form>
	);
}
