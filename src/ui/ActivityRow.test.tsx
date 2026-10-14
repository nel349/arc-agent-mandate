import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import type { Activity } from "../arc/activity.ts";
import { Amount } from "../arc/amount.ts";
import { draw } from "../test/draw.tsx";
import { ActivityRow } from "./ActivityRow.tsx";
import { activityRowText } from "./activity-format.ts";

const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const NOW = Math.floor(Date.now() / 1000);
const DRAW: Activity = {
  kind: "draw", agent: AGENT, amount: Amount.parse("0.001"), at: NOW - 120, block: 61_444_111n,
  tx: "0xa358110f8d264214723dd48a578bd84e6fe0880eedf7600861be58130069d6d3", logIndex: 4,
};
const GRANTED: Activity = { kind: "granted", agent: AGENT, amount: null, at: NOW - 86_400, block: 61_300_000n, tx: `0x${"2".repeat(64)}`, logIndex: 0 };

/**
 * The face an element is set in, from react-native-web's own rule for it: a style made with
 * `StyleSheet.create` becomes a class, and jsdom does not cascade those classes onto the element.
 */
function fontOf(element: Element): string {
  const fontClass = Array.from(element.classList).find((name) => name.startsWith("r-fontFamily-"));
  if (fontClass === undefined) return element instanceof HTMLElement ? element.style.fontFamily : "";
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
      if (rule.selectorText?.includes(fontClass)) return rule.style.getPropertyValue("font-family");
    }
  }
  return "";
}

/** The light a fresh row comes in with: the one view laid over the row that takes no touches. */
const lightOf = (row: HTMLElement): HTMLElement | null =>
  Array.from(row.querySelectorAll<HTMLElement>("div"))
    .find((div) => div.style.pointerEvents === "none") ?? null;

describe("one thing an agent did", () => {
  it("says who, what and how much in one sentence, and that it opens the receipt", () => {
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={vi.fn()} first />);
    const row = screen.getByRole("button", { name: `${text.title}. ${text.detail}. −0.001 USDC. Opens the receipt` });
    expect(row).toHaveTextContent("Scout");
    expect(row).toHaveTextContent("Moved to its balance");
    expect(row).toHaveTextContent("−0.001");
  });

  // react-native-web 0.21 has no `accessibilityHint`, so on the web the hint is the end of the name.
  it("tells a screen reader that the row opens the receipt", () => {
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={vi.fn()} first />);
    expect(screen.getByRole("button")).toHaveAccessibleName(/ Opens the receipt$/);
    expect(screen.getByRole("button").getAttribute("aria-label")).not.toMatch(/\.\./);
  });

  it("counts in the coin of its network", () => {
    const text = activityRowText(DRAW, { name: null, withAgent: false, underDayHeading: true });
    draw(<ActivityRow item={DRAW} network={MONAD_TESTNET} text={text} onPress={vi.fn()} first />);
    expect(screen.getByRole("button", { name: /−0\.001 MON\. Opens the receipt$/ })).toBeInTheDocument();
  });

  it("names real money the same way, since mainnet's coin is USDC too", () => {
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={DRAW} network={ARC_MAINNET} text={text} onPress={vi.fn()} first />);
    expect(screen.getByRole("button", { name: /−0\.001 USDC\. Opens the receipt$/ })).toBeInTheDocument();
  });

  it("shows no figure for a row that moved no money", () => {
    const text = activityRowText(GRANTED, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={GRANTED} network={ARC_TESTNET} text={text} onPress={vi.fn()} first />);
    const row = screen.getByRole("button", { name: `${text.title}. ${text.detail}. Opens the receipt` });
    expect(row).toHaveTextContent("Allowance granted");
    expect(row.textContent).not.toMatch(/−/);
  });

  it("opens the receipt of the row tapped", async () => {
    const onPress = vi.fn();
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={onPress} first />);
    await userEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledExactlyOnceWith(DRAW);
  });

  it("sets an unnamed agent's address in mono, like every other address", () => {
    const text = activityRowText(DRAW, { name: null, withAgent: true, underDayHeading: false });
    expect(text.titleIsAddress).toBe(true);
    draw(<ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={vi.fn()} first />);
    expect(fontOf(screen.getByText(text.title))).toMatch(/^Menlo/);
  });

  it("sets a named agent in the reading face, not in mono", () => {
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={vi.fn()} first />);
    expect(fontOf(screen.getByText("Scout"))).not.toMatch(/Menlo/);
  });

  it("draws a rule above every row but the first", () => {
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(
      <>
        <ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={vi.fn()} first />
        <ActivityRow item={{ ...DRAW, logIndex: 5 }} network={ARC_TESTNET} text={text} onPress={vi.fn()} first={false} />
      </>,
    );
    const [top, next] = screen.getAllByRole("button");
    expect(top?.style.borderTopWidth).toBe("");
    expect(next?.style.borderTopWidth).toBe("1px");
  });

  it("comes in lit when it has just arrived, and the light fades", async () => {
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={vi.fn()} first fresh />);
    const row = screen.getByRole("button");
    expect(Number(lightOf(row)?.style.opacity)).toBeGreaterThan(0);
    await new Promise((done) => setTimeout(done, 2_300));
    expect(lightOf(row)).toBeNull();
  });

  it("comes in unlit when it is not new", () => {
    const text = activityRowText(DRAW, { name: "Scout", withAgent: true, underDayHeading: false });
    draw(<ActivityRow item={DRAW} network={ARC_TESTNET} text={text} onPress={vi.fn()} first />);
    expect(lightOf(screen.getByRole("button"))).toBeNull();
  });
});
