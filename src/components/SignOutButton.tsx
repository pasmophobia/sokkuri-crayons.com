import { useState } from "react";

import { authClient } from "../lib/auth-client";

export default function SignOutButton() {
	const [pending, setPending] = useState(false);

	return (
		<button
			type="button"
			disabled={pending}
			onClick={async () => {
				setPending(true);
				await authClient.signOut();
				location.href = "/";
			}}
		>
			ログアウト
		</button>
	);
}
