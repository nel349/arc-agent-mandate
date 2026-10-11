import { Platform } from "react-native";

/**
 * Pulse's two faces, for the web.
 *
 * The web build is one page with no template of its own to put a stylesheet in, so the link is
 * added here, once, before anything is drawn. `display=swap` shows the fallback named in
 * `tokens.ts` until they arrive, so a slow connection gets a plainer first second and not an empty
 * one, and a browser that blocks the request gets the system font for good.
 *
 * The weights are the ones `tokens.ts` asks for and no others; a weight that is not listed here is
 * drawn by the browser faking it, which is how a heading ends up smeared.
 *
 * Native builds do not load them yet and fall back to the system font.
 *
 * This is a request to Google from a wallet's page. It carries nothing about the wallet, and it is
 * the one request the page makes that is not to a chain or to Circle; serving the files from the
 * wallet's own address would remove it.
 */
const STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=Manrope:wght@400;500;600;700&display=swap";
/** Where the stylesheet comes from, and where the font files it names do. Only the files are fetched across origins. */
const ORIGINS = [
  { href: "https://fonts.googleapis.com", crossOrigin: false },
  { href: "https://fonts.gstatic.com", crossOrigin: true },
] as const;
const MARK = "data-mandate-fonts";

export function loadFonts(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (document.head.querySelector(`link[${MARK}]`) !== null) return;
  for (const origin of ORIGINS) {
    const warm = document.createElement("link");
    warm.rel = "preconnect";
    warm.href = origin.href;
    if (origin.crossOrigin) warm.crossOrigin = "anonymous";
    document.head.appendChild(warm);
  }
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = STYLESHEET;
  sheet.setAttribute(MARK, "");
  document.head.appendChild(sheet);
}
