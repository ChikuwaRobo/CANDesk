import { desktopClient } from "./desktopClient";
import { previewClient } from "./previewClient";
import type { CanRushClient } from "./types";

export function hasTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export function getCanRushClient(): CanRushClient {
  return hasTauriRuntime() ? desktopClient : previewClient;
}
