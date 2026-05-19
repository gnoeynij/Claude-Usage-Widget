import { en } from "./en";
import { ko } from "./ko";
import type { Strings } from "./en";
import { store } from "../state/store";

export function t(): Strings {
  return store.lang === "ko" ? ko : en;
}
