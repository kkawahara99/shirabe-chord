import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthConfig } from "./auth-config.ts";
import { beginLogin, clearToken, completeLogin, getToken, logoutUrl, type LoginReturn } from "./login.ts";
import { clearSnapshot, saveSnapshot, type AfterAction, type Snapshot } from "./resume.ts";
import { browserStorage } from "./session-store.ts";

const FAILED_NOTICE = "ログインできませんでした。もう一度お試しください";
const EXPIRED_NOTICE = "ログインの有効期限が切れました。もう一度ログインしてください";

/** 画面の部品に渡す。トークンそのものは渡さない（画面とログに出さないため）。API は `apiFetch` 経由で呼ぶ。 */
export type Auth = {
  /** 設定が空なら偽。ログインと共有の画面を出さない。 */
  readonly enabled: boolean;
  readonly loggedIn: boolean;
  /** ログインの失敗・期限切れの案内。無ければ `null`。 */
  readonly notice: string | null;
  /** 進行などを退避して、Google のログインへ移る。`after` は戻ったあとに呼ぶ操作。 */
  readonly login: (after: AfterAction | null) => Promise<void>;
  readonly logout: () => void;
  /** 同じオリジンの `/api/` 以下を、トークン付きで呼ぶ。401 ならログアウトした状態にする。 */
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

const DISABLED: Auth = {
  enabled: false,
  loggedIn: false,
  notice: null,
  login: async () => {},
  logout: () => {},
  apiFetch: () => Promise.reject(new Error("ログインの設定が空です")),
};

const AuthContext = createContext<Auth>(DISABLED);
export const useAuth = (): Auth => useContext(AuthContext);

export function AuthProvider(props: {
  config: AuthConfig;
  /** 起動時の URL にあったログインの戻り。 */
  back: LoginReturn;
  /** 戻ったとき、成功したら呼ぶ操作（退避から読んだもの）。 */
  after: AfterAction | null;
  /** ログインへ移る前に退避する、いまの画面の入力。 */
  captureSnapshot: (after: AfterAction | null) => Snapshot;
  onResume: (action: AfterAction) => void;
  /** 別のページへ移る。テストで差し替える。 */
  goTo: (url: string) => void;
  children: ReactNode;
}) {
  const { config, back, after, captureSnapshot, onResume, goTo } = props;
  const storage = useRef(browserStorage()).current;
  const [loggedIn, setLoggedIn] = useState(() => getToken(storage) !== null);
  const [notice, setNotice] = useState<string | null>(null);

  // 戻りの code は 1 回しか替えられない。StrictMode が効果を二度走らせても、二度目は何もしない。
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || back.kind === "none") return;
    handled.current = true;
    window.history.replaceState(null, "", "/"); // code と state を URL とブラウザの履歴に残さない
    void completeLogin({ config, ret: back, storage, origin: window.location.origin }).then((result) => {
      clearSnapshot(storage);
      if (result === "ok") {
        setLoggedIn(true);
        if (after) onResume(after);
      } else {
        setNotice(FAILED_NOTICE);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 起動時の 1 回だけ

  const login = async (action: AfterAction | null) => {
    setNotice(null);
    try {
      saveSnapshot(storage, captureSnapshot(action));
      goTo(await beginLogin(config, storage, window.location.origin));
    } catch {
      setNotice(FAILED_NOTICE);
    }
  };

  const logout = () => {
    clearToken(storage);
    setLoggedIn(false);
    setNotice(null);
    goTo(logoutUrl(config, window.location.origin));
  };

  const apiFetch = async (path: string, init?: RequestInit) => {
    // トークンを別のオリジンへ送らない
    if (!path.startsWith("/api/")) throw new Error("API 以外には送れません");
    const headers = new Headers(init?.headers);
    const token = getToken(storage);
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(path, { ...init, headers });
    if (response.status === 401) {
      clearToken(storage);
      setLoggedIn(false);
      if (token !== null) setNotice(EXPIRED_NOTICE); // ログインしていなかった人に「期限切れ」とは言わない
    }
    return response;
  };

  return <AuthContext value={{ enabled: true, loggedIn, notice, login, logout, apiFetch }}>{props.children}</AuthContext>;
}
