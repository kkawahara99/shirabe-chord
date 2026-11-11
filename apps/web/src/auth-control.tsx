import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-context.tsx";
import { GoogleMark } from "./google-mark.tsx";

/** ヘッダーの右端。未ログインなら「Google でログイン」、ログイン済みならアイコンのメニュー。イニシャルや名前は出さない。 */
export function AuthControl(props: { onOpenMine: () => void }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === "keydown" ? (event as KeyboardEvent).key === "Escape" : !area.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  if (!auth.enabled) return null;
  return (
    <div className="auth-area" ref={area}>
      {auth.notice && (
        <p role="status" className="auth-notice">
          {auth.notice}
        </p>
      )}
      {auth.loggedIn ? (
        <>
          <button type="button" className="account-button" aria-label="アカウントのメニュー" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <circle cx="12" cy="8" r="4" fill="currentColor" />
              <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor" />
            </svg>
          </button>
          {open && (
            <div role="menu" className="account-menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  props.onOpenMine();
                }}
              >
                共有した譜面
              </button>
              <button type="button" role="menuitem" onClick={auth.logout}>
                ログアウト
              </button>
            </div>
          )}
        </>
      ) : (
        <button type="button" onClick={() => void auth.login(null)}>
          <GoogleMark />
          Google でログイン
        </button>
      )}
    </div>
  );
}
