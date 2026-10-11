import { Platform } from "react-native";

/**
 * What the browser's own page is told, once, before anything is drawn.
 *
 * Every palette here is a dark one, and a page that has not said so gets the browser's light
 * scrollbar down the side of a dark app, and light form controls where the system draws them.
 */
export function preparePage(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  document.documentElement.style.colorScheme = "dark";
}
