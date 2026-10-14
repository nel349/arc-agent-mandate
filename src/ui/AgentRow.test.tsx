import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { Amount } from "../arc/amount.ts";
import type { Mandate } from "../arc/mandate.ts";
import { draw } from "../test/draw.tsx";
import { AgentRow } from "./AgentRow.tsx";
import { agentRowLabel, endsLine } from "./mandate-format.ts";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const AGENT = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";
const NOW = Math.floor(Date.now() / 1000);
/**
 * Half a day past a whole number of days, so a second passing between drawing a row and reading it
 * cannot tip "7 days left" into 6. Exactly on the boundary, it did when the suite ran under load.
 */
const OFF_THE_BOUNDARY = 43_200;
const c = themeById(DEFAULT_THEME_ID).color;

/** An allowance as the chain reads it, as the preview screen builds them. */
function allowance(limit: string, spent: string, expiresAt?: number): Mandate {
  const l = Amount.parse(limit);
  const s = Amount.parse(spent);
  return {
    agent: AGENT, limit: l, spent: s, remaining: s.compare(l) >= 0 ? Amount.ZERO : l.subtract(s),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    agentFloat: Amount.ZERO, escrow: Amount.ZERO, lastUsedAt: null, rail: "erc20",
  };
}

/** A colour as the page writes it. */
const painted = (colour: string): string => {
  const probe = document.createElement("div");
  probe.style.color = colour;
  return probe.style.color;
};

const HALF = allowance("50", "25", NOW + 7 * 86_400 + OFF_THE_BOUNDARY);

describe("one agent in the list", () => {
  it("is one button saying who, what is left of what, and until when", () => {
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name="Scout" onPress={vi.fn()} first />);
    const row = screen.getByRole("button", { name: `${agentRowLabel(HALF, "Scout", ARC_TESTNET)} Opens this allowance` });
    expect(row).toHaveTextContent("Scout");
    expect(row).toHaveTextContent(endsLine(HALF));
    expect(row).toHaveTextContent("25.00");
    expect(row).toHaveTextContent("USDC left");
  });

  it("opens that agent's allowance when tapped", async () => {
    const onPress = vi.fn();
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name="Scout" onPress={onPress} first />);
    await userEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledExactlyOnceWith(AGENT);
  });

  it("names an unnamed agent by its address, as a fingerprint", () => {
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name={null} onPress={vi.fn()} first />);
    expect(screen.getByText("68C9 1FB4 … B17E")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Agent 0x68c91fb4…787b17e\./ })).toBeInTheDocument();
  });

  it("counts Monad's allowances in MON, at every place they were granted with", () => {
    const small = allowance("0.005", "0");
    draw(<AgentRow mandate={small} network={MONAD_TESTNET} name="Runner" onPress={vi.fn()} first />);
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("0.005");
    expect(row).toHaveTextContent("MON left");
    expect(row).toHaveTextContent("No end date");
  });

  it("counts mainnet's allowance in USDC, real money looking like what it is", () => {
    draw(<AgentRow mandate={HALF} network={ARC_MAINNET} name="Scout" onPress={vi.fn()} first />);
    expect(screen.getByRole("button", { name: /25\.00 USDC left of 50\.00/ })).toBeInTheDocument();
  });

  it("says when it is spending, and still when it ends", () => {
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name="Scout" onPress={vi.fn()} first pulse="spending" />);
    const row = screen.getByRole("button", { name: /Spending now\. Opens this allowance$/ });
    expect(row).toHaveTextContent("Spending now");
    expect(row).toHaveTextContent(`· ${endsLine(HALF)}`);
  });

  it("says nothing about spending while it rests", () => {
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name="Scout" onPress={vi.fn()} first />);
    expect(screen.getByRole("button").textContent).not.toMatch(/Spending now/);
  });

  it("shows its ERC-8004 identity on its own line, in full, once it is confirmed", () => {
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name="Scout" identity={2419n} onPress={vi.fn()} first />);
    expect(screen.getByText("ERC-8004 #2419")).toBeInTheDocument();
  });

  it("shows no identity line while there is none confirmed", () => {
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name="Scout" onPress={vi.fn()} first />);
    expect(screen.queryByText(/ERC-8004/)).toBeNull();
  });

  it("warns in the figure when little is left, at the ring's own threshold", () => {
    draw(<AgentRow mandate={allowance("50", "48", NOW + 86_400 + OFF_THE_BOUNDARY)} network={ARC_TESTNET} name="Scout" onPress={vi.fn()} first />);
    expect(screen.getByText("2.00").style.color).toBe(painted(c.signal));
  });

  it("keeps the figure calm while plenty is left", () => {
    draw(<AgentRow mandate={HALF} network={ARC_TESTNET} name="Scout" onPress={vi.fn()} first />);
    expect(screen.getByText("25.00").style.color).toBe(painted(c.paper));
  });

  it("says when an ended allowance ended, and dims what it had left", () => {
    const ended = allowance("50", "10", NOW - 86_400);
    draw(<AgentRow mandate={ended} network={ARC_TESTNET} name="Scout" onPress={vi.fn()} first />);
    expect(screen.getByText(endsLine(ended))).toHaveTextContent(/^Ended /);
    expect(screen.getByText(endsLine(ended)).style.color).toBe(painted(c.stop));
    expect(screen.getByText("40.00").style.color).toBe(painted(c.dim));
  });

  it("draws a rule above every row but the first", () => {
    draw(
      <>
        <AgentRow mandate={HALF} network={ARC_TESTNET} name="One" onPress={vi.fn()} first />
        <AgentRow mandate={HALF} network={ARC_TESTNET} name="Two" onPress={vi.fn()} first={false} />
      </>,
    );
    const [top, next] = screen.getAllByRole("button");
    expect(top?.style.borderTopWidth).toBe("");
    expect(next?.style.borderTopWidth).toBe("1px");
  });
});
