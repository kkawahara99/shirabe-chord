import { readItem, writeItem, type StorageLike } from "./session-store.ts";

export type Theme = "light" | "dark";

export const THEME_KEY = "shirabe-theme";

/** タブを閉じても残したい設定なので `localStorage`。プライベートウィンドウなどでは触れただけで例外になる。 */
export function themeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 画面で選んだ配色。選んでいなければ `null`（OS の設定に従う）。 */
export function readTheme(storage: StorageLike | null): Theme | null {
  const value = storage ? readItem(storage, THEME_KEY) : null;
  return value === "light" || value === "dark" ? value : null;
}

export function saveTheme(storage: StorageLike | null, theme: Theme): void {
  if (storage) writeItem(storage, THEME_KEY, theme);
}

/** `<html data-theme>` に反映する。`null` なら外して OS の設定に任せる。 */
export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** OS の配色。`matchMedia` が無い環境（テスト）は明るい扱い。 */
export function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
