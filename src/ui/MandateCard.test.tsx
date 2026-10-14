import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { Amount } from "../arc/amount.ts";
import type { Mandate } from "../arc/mandate.ts";
import { draw } from "../test/draw.tsx";
import { MandateCard } from "./MandateCard.tsx";
import { expiryLine, spentLine } from "./mandate-format.ts";

const AGENT = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";
const NOW = Math.floor(Date.now() / 1000);
/** Half a day off a whole number of days, so the seconds a run takes cannot change the days left it reads. */
const OFF_THE_BOUNDARY = 43_200;

function allowance(limit: string, spent: string, extra: Partial<Mandate> = {}): Mandate {
  const l = Amount.parse(limit);
  const s = Amount.parse(spent);
  return {
    agent: AGENT, limit: l, spent: s, remaining: s.compare(l) >= 0 ? Amount.ZERO : l.subtract(s),
    expiresAt: NOW + 3 * 86_400 + OFF_THE_BOUNDARY, agentFloat: Amount.ZERO, escrow: Amount.ZERO, lastUsedAt: null, rail: "erc20",
    ...extra,
  };
}

describe("one allowance, as a card", () => {
  it("names the agent and when it expires, each under a word saying what it is", () => {
    const mandate = allowance("50", "25");
    draw(<MandateCard mandate={mandate} network={ARC_TESTNET} onRevoke={vi.fn()} busy={false} />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("0x68c91fb4…787b17e")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.getByText(expiryLine(mandate))).toBeInTheDocument();
  });

  it("leads with what is left, with the ring saying what is gone", () => {
    const mandate = allowance("50", "25");
    draw(<MandateCard mandate={mandate} network={ARC_TESTNET} onRevoke={vi.fn()} busy={false} />);
    expect(screen.getByText(/^25\.00/)).toHaveTextContent("25.00 USDC left");
    expect(screen.getByText(spentLine(mandate, ARC_TESTNET))).toBeInTheDocument();
    expect(screen.getByLabelText("25.00 of 50.00 USDC spent")).toBeInTheDocument();
  });

  it("counts in MON on Monad", () => {
    draw(<MandateCard mandate={allowance("0.01", "0.002")} network={MONAD_TESTNET} onRevoke={vi.fn()} busy={false} />);
    expect(screen.getByText(/^0\.008/)).toHaveTextContent("0.008 MON left");
    expect(screen.getByLabelText("0.002 of 0.01 MON spent")).toBeInTheDocument();
  });

  it("warns when the agent holds money it should not", () => {
    draw(<MandateCard mandate={allowance("50", "10", { agentFloat: Amount.parse("0.5") })} network={ARC_TESTNET} onRevoke={vi.fn()} busy={false} />);
    expect(screen.getByText("agent holds 0.50")).toBeInTheDocument();
  });

  it("says nothing about dust too small to act on", () => {
    draw(<MandateCard mandate={allowance("50", "10", { agentFloat: Amount.parse("0.001") })} network={ARC_TESTNET} onRevoke={vi.fn()} busy={false} />);
    expect(screen.queryByText(/agent holds/)).toBeNull();
  });

  it("revokes this agent's allowance when Revoke is tapped", async () => {
    const onRevoke = vi.fn();
    draw(<MandateCard mandate={allowance("50", "25")} network={ARC_TESTNET} onRevoke={onRevoke} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith(AGENT);
  });

  it("cannot be revoked twice while a revoke is under way, and says it is busy", () => {
    const onRevoke = vi.fn();
    draw(<MandateCard mandate={allowance("50", "25")} network={ARC_TESTNET} onRevoke={onRevoke} busy />);
    const revoke = screen.getByRole("button", { name: "Revoke" });
    expect(revoke).toHaveAttribute("aria-busy", "true");
    expect(revoke).toHaveAttribute("aria-disabled", "true");
    // The page takes no pointer on a busy button; a click sent straight at it still does nothing.
    fireEvent.click(revoke);
    expect(onRevoke).not.toHaveBeenCalled();
  });
});
