import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import unocss from "unocss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [unocss(), solid()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    // Print gzip sizes during build so we notice bundle bloat without
    // having to inspect `dist/` manually.
    reportCompressedSize: true,
  },
});
