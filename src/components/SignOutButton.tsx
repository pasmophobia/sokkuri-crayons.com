import { useState } from "react";

import { localePath, useTranslations, type Locale } from "../i18n";
import { authClient } from "../lib/auth-client";

export default function SignOutButton({ locale }: { locale: Locale }) {
	const [pending, setPending] = useState(false);
	const t = useTranslations(locale);

	return (
		<button
			type="button"
			disabled={pending}
			onClick={async () => {
				setPending(true);
				await authClient.signOut();
				location.href = localePath(locale, "/");
			}}
		>
			{t("nav.signOut")}
		</button>
	);
}
