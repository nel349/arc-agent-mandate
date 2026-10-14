import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../ui/theme-context.tsx";

/** A phone's frame with no notch, so a screen that reads its insets has some to read. */
const FRAME = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** A component drawn as the app draws it: inside the theme and the safe area the root layout gives every screen. */
export function draw(ui: ReactElement): RenderResult {
  return render(
    <SafeAreaProvider initialMetrics={FRAME}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>,
  );
}

/**
 * What a browser does when a CSS animation finishes, which jsdom never does: it runs none.
 *
 * react-native-web keeps a sliding sheet on the page until its slide-out animation ends, so without
 * this a closed sheet would stay forever in a test. Sent to every element as its own target, which
 * is how the browser sends it; only the sheet's frame listens.
 */
export function endAnimations(): void {
  act(() => {
    for (const element of Array.from(document.body.querySelectorAll("*"))) fireEvent.animationEnd(element);
  });
}
