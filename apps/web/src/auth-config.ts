/** ログインと共有に要る、ビルド時の設定。 */
export type AuthConfig = {
  /** Cognito のドメイン（`https://` から始まり、末尾の `/` は無い）。 */
  readonly cognitoDomain: string;
  readonly clientId: string;
  /** 共有の作成で使う（Turnstile）。ログインには使わないが、空なら共有の画面ごと出さない。 */
  readonly turnstileSiteKey: string;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * 環境変数（`import.meta.env`）から設定を読む。どれかが空、またはドメインが `https://` の URL でなければ `null`
 * （ログインと共有の画面を出さず、これまでどおりの画面になる。docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
 */
export function readAuthConfig(env: Readonly<Record<string, unknown>>): AuthConfig | null {
  const domain = text(env.VITE_COGNITO_DOMAIN);
  const clientId = text(env.VITE_COGNITO_CLIENT_ID);
  const turnstileSiteKey = text(env.VITE_TURNSTILE_SITE_KEY);
  if (!domain || !clientId || !turnstileSiteKey) return null;
  try {
    const url = new URL(domain);
    if (url.protocol !== "https:" || !url.hostname) return null;
  } catch {
    return null;
  }
  return { cognitoDomain: domain.replace(/\/+$/, ""), clientId, turnstileSiteKey };
}
