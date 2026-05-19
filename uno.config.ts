import { defineConfig, presetUno } from "unocss";

export default defineConfig({
  presets: [presetUno({ dark: "class" })],
  theme: {
    fontFamily: {
      ui: [
        "-apple-system",
        "BlinkMacSystemFont",
        "SF Pro Text",
        "Inter Variable",
        "Inter",
        "Segoe UI Variable",
        "Segoe UI",
        "system-ui",
        "sans-serif",
      ].join(","),
      ko: ["SUIT Variable", "SUIT", "-apple-system", "system-ui", "sans-serif"].join(","),
      mono: ["SF Mono", "Cascadia Mono", "Consolas", "ui-monospace", "monospace"].join(","),
    },
  },
  rules: [
    ["app-region-drag", { "-webkit-app-region": "drag" } as any],
    ["app-region-none", { "-webkit-app-region": "no-drag" } as any],
    ["tabular-nums", { "font-variant-numeric": "tabular-nums" }],
  ],
});
