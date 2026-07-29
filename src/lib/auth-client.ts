import { createAuthClient } from "better-auth/client";

/** ブラウザ側の better-auth クライアント。baseURL は現在の origin が既定。 */
export const authClient = createAuthClient();
