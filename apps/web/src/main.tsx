import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./style.css";
import { applyTheme, readTheme, themeStorage } from "./theme.ts";

// 描く前に反映して、選んだ配色と違う色が一瞬出るのを減らす（CSP でインラインのスクリプトは使えない）
applyTheme(readTheme(themeStorage()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
