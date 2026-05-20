import { onMount, Show } from "solid-js";
import { LiquidGlass } from "./components/LiquidGlass";
import { ErrorBanner } from "./components/ErrorBanner";
import { HeaderBar } from "./views/HeaderBar";
import { FooterBar } from "./views/FooterBar";
import { NormalView } from "./views/NormalView";
import { MiniView } from "./views/MiniView";
import { DetailView } from "./views/DetailView";
import { SettingsPanel } from "./views/SettingsPanel";
import { store, initStore } from "./state/store";

export function App() {
  onMount(() => {
    void initStore();
  });

  return (
    <LiquidGlass>
      {store.mode !== "mini" && <HeaderBar />}
      {store.mode !== "mini" && <ErrorBanner />}
      {store.mode === "mini" && <MiniView />}
      {store.mode === "normal" && <NormalView />}
      {store.mode === "detail" && <DetailView />}
      {store.mode !== "mini" && <FooterBar />}
      <Show when={store.settingsOpen && store.mode !== "mini"}>
        <SettingsPanel />
      </Show>
    </LiquidGlass>
  );
}
