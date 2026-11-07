import type { SiteverifyResult } from "./types.ts";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/** `fetch` のうち使う部分。テストで差し替える。 */
export type FetchLike = (
  url: string,
  init: { method: "POST"; body: URLSearchParams; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** 利用者のトークンの問題。それ以外の失敗（secret の誤り・Cloudflare の不調など）はこちらの側の問題。 */
const TOKEN_PROBLEMS = new Set(["timeout-or-duplicate", "invalid-input-response", "missing-input-response"]);

/** こちらの側の失敗。ログには `name` だけが残るので、原因ごとに名前を分ける（メッセージは入力を含まない）。 */
function upstreamError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

/**
 * Turnstile の `siteverify` を呼ぶ。トークンが通らないときは `success: false` を返し、
 * 通信の失敗・時間切れ・こちらの側の問題は例外にする。
 */
export function createSiteverify(options: { fetch: FetchLike; getSecret: () => Promise<string> }) {
  return async (token: string): Promise<SiteverifyResult> => {
    const response = await options.fetch(SITEVERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret: await options.getSecret(), response: token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw upstreamError("SiteverifyHttpError");
    const data = await response.json();
    if (typeof data !== "object" || data === null) throw upstreamError("SiteverifyInvalidResponse");
    const { success, hostname } = data as Record<string, unknown>;
    if (success === true) return { success: true, hostname: typeof hostname === "string" ? hostname : undefined };

    const codes = (data as Record<string, unknown>)["error-codes"];
    const list = Array.isArray(codes) ? codes : [];
    // 理由が分からない失敗（コードが無い）は、利用者のせいと決めつけない
    if (list.length > 0 && list.every((code) => typeof code === "string" && TOKEN_PROBLEMS.has(code))) return { success: false };
    throw upstreamError("SiteverifyRejected");
  };
}
