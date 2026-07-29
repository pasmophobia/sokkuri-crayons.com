/**
 * E2E の接続先。`playwright.config.ts`（サーバを起こす側）と `fixtures.ts`
 * （Origin ヘッダを組み立てる側）の両方から読むので、一箇所に置いておく。
 */

export const PORT = Number(process.env.E2E_PORT ?? 4321);

export const BASE_URL = `http://localhost:${PORT}`;
