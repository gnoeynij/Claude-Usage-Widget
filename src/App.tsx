import { onMount, Show } from "solid-js";
import { LiquidGlass } from "./components/LiquidGlass";
import { ErrorBanner } from "./components/ErrorBanner";
import { HeaderBar } from "./views/HeaderBar";
import { FooterBar } from "./views/FooterBar";
import { NormalView } from "./views/NormalView";
import { MiniView } from "./views/MiniView";
import { DetailView } from "./views/DetailView";
import { SettingsPanel } from "./views/SettingsPanel";
import { GlassToast } from "./components/GlassToast";
import { store, initStore } from "./state/store";

/** The widget's full chrome (glass panel + header/view/footer/settings) driven
 *  by store.mode. Extracted so the guide window can render the *real* widget
 *  (identical look) with a seeded store, not an approximation. */
export function WidgetChrome() {
  return (
    <LiquidGlass padding={store.mode === "mini" ? "0" : undefined}>
      {store.mode !== "mini" && <HeaderBar />}
      {/* Relative wrapper so ErrorBanner can overlay the *top of the content*
          (floating over it, like the toast) instead of taking a flex slot that
          pushes the donut/content down. Header stays visible above it. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          "flex-direction": "column",
          flex: 1,
          "min-height": 0,
        }}
      >
        {store.mode === "mini" && <MiniView />}
        {store.mode === "normal" && <NormalView />}
        {store.mode === "detail" && <DetailView />}
        {store.mode !== "mini" && <ErrorBanner />}
      </div>
      {store.mode !== "mini" && <FooterBar />}
      <Show when={store.settingsOpen && store.mode !== "mini"}>
        <SettingsPanel />
      </Show>
      <GlassToast />
    </LiquidGlass>
  );
}

export function App() {
  onMount(() => {
    void initStore();
  });

  return <WidgetChrome />;
}
