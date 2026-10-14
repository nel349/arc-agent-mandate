/**
 * react-native-web swaps its animations for a stand-in that finishes at once when NODE_ENV is "test"
 * (`Platform.isTesting`), so a beat or a fading light would be over before a test could see it. Named
 * another environment here, before anything loads react-native-web, every test draws with the real
 * animation engine the page runs on.
 */
process.env.NODE_ENV = "development";

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom parses `@font-face` rules but does not name their class on `window`, and Expo's font loader
 * asks `rule instanceof CSSFontFaceRule` before drawing an icon. The class is jsdom's own, read off a
 * rule it parsed, so the loader is checking the real thing.
 */
if (typeof globalThis.CSSFontFaceRule === "undefined") {
  const style = document.createElement("style");
  style.textContent = "@font-face { font-family: probe; src: local(probe); }";
  document.head.append(style);
  const rule = style.sheet?.cssRules[0];
  style.remove();
  if (rule === undefined) throw new Error("jsdom no longer parses @font-face; the font loader needs another way in");
  Object.defineProperty(globalThis, "CSSFontFaceRule", { value: rule.constructor, configurable: true });
  // A browser reads a declaration back by its camel-case name too, `style.fontFamily`, and Expo does.
  // jsdom's @font-face declarations answer only `getPropertyValue`, so the name is given to its class.
  const declarations = Object.getPrototypeOf((rule as CSSFontFaceRule).style) as object;
  if (!("fontFamily" in declarations)) {
    Object.defineProperty(declarations, "fontFamily", {
      get(this: CSSStyleDeclaration) { return this.getPropertyValue("font-family"); },
      configurable: true,
    });
  }
}

/**
 * The icon font, declared on the page as it is once it has arrived.
 *
 * jsdom downloads no fonts. Without this, the first icon drawn asks Expo to load its font, and Expo
 * waits on it by polling for six seconds, which outlives a test file: the poll then fires after the
 * page is gone and fails the run at random. Declared in Expo's own stylesheet, in the form Expo writes,
 * the font reads as present, as it does in a browser after the first load, and nothing polls. Checked
here, so a change in how Expo tells a loaded font fails loudly rather than bringing the poll back.
 */
const ICON_FONTS = ["ionicons"];
{
  const style = document.createElement("style");
  style.id = "expo-generated-fonts";
  // Unquoted: jsdom keeps quotes a browser drops when the rule is read back, and Expo compares names.
  style.textContent = ICON_FONTS.map((family) => `@font-face{font-family:${family};src:url("${family}.ttf");font-display:auto}`).join("");
  document.head.append(style);
  const { isLoaded } = await import("expo-font");
  const missing = ICON_FONTS.filter((family) => !isLoaded(family));
  if (missing.length > 0) throw new Error(`Expo does not see ${missing.join(", ")} as loaded; its font check has changed`);
}

// Each test starts on an empty page.
afterEach(() => cleanup());
