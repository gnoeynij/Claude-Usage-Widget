import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { info, warn } from "@tauri-apps/plugin-log";
import { setStore, store } from "./store";

let currentUpdate: Update | null = null;

export type CheckResult = "available" | "up_to_date" | "error";

export async function checkForUpdate(manual: boolean): Promise<CheckResult> {
  if (
    store.updateStatus === "checking" ||
    store.updateStatus === "downloading"
  ) {
    return store.updateStatus === "downloading" ? "available" : "up_to_date";
  }
  setStore("updateStatus", "checking");
  try {
    const update = await check();
    if (!update) {
      currentUpdate = null;
      setStore("updateInfo", null);
      setStore("updateStatus", "idle");
      void info(`updater: up to date (manual=${manual})`);
      return "up_to_date";
    }
    currentUpdate = update;
    setStore("updateInfo", {
      version: update.version,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
    });
    setStore("updateStatus", "available");
    setStore("updateDownloadPct", 0);
    void info(`updater: ${update.version} available, downloading`);
    void startDownload();
    return "available";
  } catch (e) {
    void warn(`updater: check failed (manual=${manual}): ${String(e)}`);
    if (manual) {
      setStore("updateStatus", "error");
    } else {
      setStore("updateStatus", "idle");
    }
    return "error";
  }
}

async function startDownload() {
  if (!currentUpdate) return;
  setStore("updateStatus", "downloading");
  setStore("updateDownloadPct", 0);
  let total = 0;
  let downloaded = 0;
  try {
    await currentUpdate.download((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setStore(
              "updateDownloadPct",
              Math.min(100, Math.round((downloaded / total) * 100)),
            );
          }
          break;
        case "Finished":
          setStore("updateDownloadPct", 100);
          break;
      }
    });
    setStore("updateStatus", "ready");
    void info(`updater: download complete, awaiting user install`);
  } catch (e) {
    void warn(`updater: download failed: ${String(e)}`);
    setStore("updateStatus", "error");
  }
}

export async function installUpdate() {
  if (!currentUpdate) return;
  try {
    void info(`updater: install + relaunch`);
    await currentUpdate.install();
    await relaunch();
  } catch (e) {
    void warn(`updater: install failed: ${String(e)}`);
    setStore("updateStatus", "error");
  }
}
