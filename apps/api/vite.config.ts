import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    // Lambda（Node.js 24）に載せる 1 本の ESM。zip は Terraform の archive_file が作る
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "index.mjs" },
    target: "node24",
    minify: false,
    rollupOptions: {
      // AWS SDK は Lambda のランタイム付属のものを使う。コア（workspace）はまとめる
      external: [/^@aws-sdk\//, /^node:/],
    },
  },
  test: {
    environment: "node",
    // 1 件の上限は 5 秒（docs/adr/0034-cap-each-test-at-five-seconds.md）。個別に延ばさない。
    // 上限は .github/tests/test_test_limits.py が守る。
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
