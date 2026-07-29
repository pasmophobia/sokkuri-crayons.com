import { createAuthClient } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";

/**
 * ブラウザ側の better-auth クライアント。baseURL は現在の origin が既定。
 * サーバの plugins と揃えないと username 関連の型と経路が生えない。
 */
export const authClient = createAuthClient({
	plugins: [usernameClient()],
});
