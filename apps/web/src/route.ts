export type Route =
  | { readonly kind: "home" }
  | { readonly kind: "mine" }
  | { readonly kind: "share"; readonly id: string };

// 共有 ID の形は apps/api/src/share-id.ts と同じ（128 ビットの乱数を base64url にした 22 文字）。web から api は読めないので写している。
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;
const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]{22})\/?$/;

/** サーバーが返した ID を URL に使う前の確認。 */
export const isShareId = (value: unknown): value is string => typeof value === "string" && SHARE_ID.test(value);

/** URL のパスから画面を決める。知らないパスはトップ。 */
export function parseRoute(pathname: string): Route {
  if (/^\/mine\/?$/.test(pathname)) return { kind: "mine" };
  const share = SHARE_PATH.exec(pathname);
  return share ? { kind: "share", id: share[1]! } : { kind: "home" };
}
