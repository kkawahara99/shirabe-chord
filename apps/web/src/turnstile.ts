// Cloudflare Turnstile のウィジェット。スクリプトは共有ダイアログを開いたときだけ読み込む（共有を使わない人には読み込まない）。
// 配信のヘッダ（CSP）で challenges.cloudflare.com を許している（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。

export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileOptions = {
  readonly sitekey: string;
  readonly callback: (token: string) => void;
  readonly "expired-callback": () => void;
  readonly "error-callback": () => void;
};

/** 使う部分だけ。 */
export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** スクリプトを 1 度だけ読み込む。読み込めなかったら失敗し、次の呼び出しでやり直せる。 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    const done = (): void => {
      loading = null;
    };
    script.addEventListener("load", () => {
      done();
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile を使えません"));
    });
    script.addEventListener("error", () => {
      done();
      script.remove();
      reject(new Error("Turnstile を読み込めません"));
    });
    document.head.append(script);
  });
  return loading;
}
