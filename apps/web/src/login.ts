import type { AuthConfig } from "./auth-config.ts";
import { readItem, removeItem, writeItem, type StorageLike } from "./session-store.ts";

// 認可コード＋PKCE（RFC 7636）。ホステッド UI へ移り、戻りの code をトークンに替える。依存を足さず、crypto.subtle と fetch で書く。
// トークンは sessionStorage にだけ置く。画面にもログにも出さない（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。

const PENDING_KEY = "shirabe-chord.login-pending";
const TOKEN_KEY = "shirabe-chord.access-token";

/** ログインの戻り先（Cognito のコールバック URL とログアウト URL に登録した値）。 */
const returnUri = (origin: string) => `${origin}/`;

const base64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const randomToken = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** PKCE の code_challenge（S256）。 */
export async function challengeOf(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** state と verifier を作って退避し、Cognito の認可 URL を返す（Google のログインへ直行させる）。 */
export async function beginLogin(config: AuthConfig, storage: StorageLike, origin: string): Promise<string> {
  const state = randomToken();
  const verifier = randomToken();
  if (!writeItem(storage, PENDING_KEY, JSON.stringify({ state, verifier }))) {
    throw new Error("ログインの途中経過を保存できません");
  }
  const url = new URL(`${config.cognitoDomain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid",
    redirect_uri: returnUri(origin),
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
    identity_provider: "Google",
  }).toString();
  return url.toString();
}

export type LoginReturn =
  | { readonly kind: "none" }
  | { readonly kind: "code"; readonly code: string; readonly state: string }
  /** 取りやめ・Cognito からのエラー・値の欠け。 */
  | { readonly kind: "failed" };

/** URL の検索部分（`location.search`）から、ログインの戻りを読む。値はまだ信用しない（`completeLogin` が state を照合する）。 */
export function parseLoginReturn(search: string): LoginReturn {
  const params = new URLSearchParams(search);
  if (params.has("error")) return { kind: "failed" };
  const code = params.get("code");
  const state = params.get("state");
  if (code === null && state === null) return { kind: "none" };
  return code && state ? { kind: "code", code, state } : { kind: "failed" };
}

/** 退避した state と verifier を取り出して消す（1 回しか使えない）。無い・壊れているときは `null`。 */
function takePending(storage: StorageLike): { state: string; verifier: string } | null {
  const raw = readItem(storage, PENDING_KEY);
  removeItem(storage, PENDING_KEY);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { state, verifier } = value as Record<string, unknown>;
    return typeof state === "string" && typeof verifier === "string" && state && verifier ? { state, verifier } : null;
  } catch {
    return null;
  }
}

/**
 * 戻りを検証し、code をアクセストークンに替えて保存する。失敗は例外にせず `"failed"` を返す。
 * state が違う・退避が無いときは、トークンの交換の通信をしない。
 */
export async function completeLogin(args: {
  config: AuthConfig;
  ret: Exclude<LoginReturn, { kind: "none" }>;
  storage: StorageLike;
  origin: string;
  fetchFn?: typeof fetch;
}): Promise<"ok" | "failed"> {
  const { config, ret, storage, origin } = args;
  const pending = takePending(storage); // 成功でも失敗でも、使った組は消す
  if (ret.kind !== "code" || pending === null || ret.state !== pending.state) return "failed";
  try {
    const response = await (args.fetchFn ?? fetch)(`${config.cognitoDomain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code: ret.code,
        redirect_uri: returnUri(origin),
        code_verifier: pending.verifier,
      }).toString(),
    });
    if (!response.ok) return "failed";
    const body: unknown = await response.json();
    const token = typeof body === "object" && body !== null ? (body as Record<string, unknown>).access_token : undefined;
    return typeof token === "string" && token && storeToken(storage, token) ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export function storeToken(storage: StorageLike, token: string): boolean {
  return writeItem(storage, TOKEN_KEY, token);
}

export function getToken(storage: StorageLike): string | null {
  return readItem(storage, TOKEN_KEY) || null;
}

export function clearToken(storage: StorageLike): void {
  removeItem(storage, TOKEN_KEY);
}

export function logoutUrl(config: AuthConfig, origin: string): string {
  const url = new URL(`${config.cognitoDomain}/logout`);
  url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: returnUri(origin) }).toString();
  return url.toString();
}
