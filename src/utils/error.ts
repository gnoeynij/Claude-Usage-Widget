/** Coerce an unknown thrown value into a display-ready string. `String(e)`
 *  on a plain object yields "[object Object]"; this preserves the Error
 *  message and falls back safely for other shapes (Tauri serialized errors,
 *  primitives, undefined). */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
