import { useEffect, useState } from "react";
import { Icon } from "./icon.tsx";
import { applyTheme, readTheme, saveTheme, systemTheme, themeStorage, type Theme } from "./theme.ts";

/** OS の配色。選んでいない間は、開いたまま OS が切り替わっても、ボタンの向きが実際の色に合うよう追う。 */
function useSystemTheme(): Theme {
  const [system, setSystem] = useState<Theme>(systemTheme);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystem(systemTheme());
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return system;
}

/** ライト／ダークの切り替え。最初は OS の設定に従い、押すと反対側を選んで覚える。図は押した先の配色を表す。 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Theme | null>(() => readTheme(themeStorage()));
  const system = useSystemTheme();
  useEffect(() => applyTheme(choice), [choice]);

  const current = choice ?? system;
  const next: Theme = current === "dark" ? "light" : "dark";
  const label = next === "dark" ? "ダークにする" : "ライトにする";
  const choose = () => {
    saveTheme(themeStorage(), next);
    setChoice(next);
  };

  return (
    <button type="button" className="theme-toggle" aria-label={label} title={label} onClick={choose}>
      <Icon name={next === "dark" ? "moon" : "sun"} />
    </button>
  );
}
