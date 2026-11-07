import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // style.css?raw を空文字にしない（dark-mode.test.ts が CSS の文字列を読む）。
    // 普通の import にも効くので、main.tsx を読むテストを足すときは jsdom に CSS が入る点に注意。
    css: { include: [/style\.css/] },
    setupFiles: ["./src/test-setup.ts"],
    // 1 件の上限は 5 秒（docs/adr/0034-cap-each-test-at-five-seconds.md）。個別に延ばさない。
    // 上限は .github/tests/test_test_limits.py が守る。
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
