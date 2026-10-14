import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { Screen } from "./Screen.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";
import { tokens } from "./tokens.ts";

const c = themeById(DEFAULT_THEME_ID).color;

/**
 * A phone with a notch and a home indicator, so the insets have something in them.
 *
 * Given through the library's own insets context, which is what its provider fills once it has
 * measured the device. In a browser the provider measures the page, and jsdom lays nothing out, so
 * a provider here would measure nought whatever it was started with.
 */
const NOTCHED = { insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const onNotchedPhone = (ui: ReactElement) => draw(<SafeAreaInsetsContext.Provider value={NOTCHED.insets}>{ui}</SafeAreaInsetsContext.Provider>);

/** The element a text sits in, `levels` up. */
const up = (element: Element, levels: number): HTMLElement => {
  let at: Element = element;
  for (let i = 0; i < levels; i++) at = at.parentElement!;
  return at as HTMLElement;
};

describe("a screen", () => {
  it("draws its content on the theme's ground", () => {
    const { container } = draw(<Screen><Text>Balance</Text></Screen>);
    expect(screen.getByText("Balance")).toBeInTheDocument();
    // In a build without the gradient, and in these tests, the ground is the middle stop, flat.
    expect(container.querySelector(`[style*="background-color"]`)).toHaveStyle({ backgroundColor: c.groundMid });
  });

  it("puts its own bar above the content, and its main action pinned below it", () => {
    draw(<Screen header={<Text>Top bar</Text>} footer={<Text>New allowance</Text>}><Text>Content</Text></Screen>);
    const top = screen.getByText("Top bar");
    const content = screen.getByText("Content");
    const action = screen.getByText("New allowance");
    expect(top.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(content.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("holds the main action clear of the home indicator", () => {
    onNotchedPhone(<Screen footer={<Text>New allowance</Text>}><Text>Content</Text></Screen>);
    // The action, then the column it is drawn in, then the bar pinned to the bottom.
    const bar = up(screen.getByText("New allowance"), 2);
    expect(bar).toHaveStyle({ position: "absolute", bottom: "0px", paddingBottom: `${NOTCHED.insets.bottom + tokens.space.sm}px` });
  });

  it("a centred screen with no bar of its own clears the status bar itself", () => {
    onNotchedPhone(<Screen centered><Text>Welcome</Text></Screen>);
    const column = up(screen.getByText("Welcome"), 1);
    expect(column).toHaveStyle({ paddingTop: `${NOTCHED.insets.top}px`, justifyContent: "center" });
  });

  it("a centred screen under a bar of its own leaves the status bar to that bar", () => {
    onNotchedPhone(<Screen centered header={<Text>Top bar</Text>}><Text>Welcome</Text></Screen>);
    expect(up(screen.getByText("Welcome"), 1)).toHaveStyle({ paddingTop: `${tokens.space.lg}px` });
  });

  it("a screen built around one thing still shows it, and its action", () => {
    draw(<Screen fill footer={<Text>Continue</Text>}><Text>20.00</Text></Screen>);
    expect(screen.getByText("20.00")).toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeInTheDocument();
  });
});
