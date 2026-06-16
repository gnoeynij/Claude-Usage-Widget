import { defineConfig } from "vitest/config";

// Scoped to PURE projection / pace math (src/utils/project.ts). No DOM, no
// SolidJS, no Tauri — so we deliberately skip the app's vite plugins and run in
// a plain node environment. UI / store wiring stays manually verified (see
// CLAUDE.md "테스트 프레임워크").
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
