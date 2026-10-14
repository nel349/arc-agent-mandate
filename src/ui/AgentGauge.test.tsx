import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { Amount } from "../arc/amount.ts";
import type { Mandate } from "../arc/mandate.ts";
import { draw } from "../test/draw.tsx";
import { AgentGauge } from "./AgentGauge.tsx";
import { allowanceSentence, spentLine } from "./mandate-format.ts";

const NOW = Math.floor(Date.now() / 1000);

/** An allowance as the chain reads it. Each test gives its own agent, since a pulse is remembered per agent. */
function allowance(agent: `0x${string}`, limit: string, spent: string, expiresAt?: number): Mandate {
  const l = Amount.parse(limit);
  const s = Amount.parse(spent);
  return {
    agent, limit: l, spent: s, remaining: s.compare(l) >= 0 ? Amount.ZERO : l.subtract(s),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    agentFloat: Amount.ZERO, escrow: Amount.ZERO, lastUsedAt: null, rail: "erc20",
  };
}
const agent = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;

describe("one agent, on its own screen", () => {
  it("puts what is left inside the ring, in the coin of its network", () => {
    const mandate = allowance(agent(1), "50", "12.5", NOW + 86_400);
    draw(<AgentGauge mandate={mandate} network={ARC_TESTNET} lastSpent={null} />);
    expect(screen.getByText("37.50")).toBeInTheDocument();
    expect(screen.getByText("USDC left")).toBeInTheDocument();
    expect(screen.getByText(spentLine(mandate, ARC_TESTNET))).toBeInTheDocument();
  });

  it("counts Monad's allowance in MON, at the precision it was granted", () => {
    const mandate = allowance(agent(2), "0.01", "0.002", NOW + 86_400);
    draw(<AgentGauge mandate={mandate} network={MONAD_TESTNET} lastSpent={null} />);
    expect(screen.getByText("0.008")).toBeInTheDocument();
    expect(screen.getByText("MON left")).toBeInTheDocument();
  });

  it("rests when nothing has been paid lately, and says so in one sentence", () => {
    const mandate = allowance(agent(3), "50", "10", NOW + 86_400);
    draw(<AgentGauge mandate={mandate} network={ARC_TESTNET} lastSpent={NOW - 3_600} />);
    expect(screen.getByText("Resting")).toBeInTheDocument();
    expect(screen.getByLabelText(`Resting. 40.00 USDC left, ${spentLine(mandate, ARC_TESTNET)}.`)).toBeInTheDocument();
  });

  it("says it is spending when money moved moments ago", () => {
    const mandate = allowance(agent(4), "50", "10", NOW + 86_400);
    draw(<AgentGauge mandate={mandate} network={ARC_TESTNET} lastSpent={NOW - 10} />);
    expect(screen.getByText("Spending now")).toBeInTheDocument();
  });

  it("says nothing is left once it is all spent", () => {
    const mandate = allowance(agent(5), "50", "50", NOW + 3 * 86_400);
    draw(<AgentGauge mandate={mandate} network={ARC_TESTNET} lastSpent={NOW - 3_600} />);
    expect(screen.getByText("Nothing left")).toBeInTheDocument();
    expect(screen.getByText("0.00")).toBeInTheDocument();
  });

  it("says when it ended, and that nothing more can be spent", () => {
    const mandate = allowance(agent(6), "50", "20", NOW - 86_400);
    draw(<AgentGauge mandate={mandate} network={ARC_TESTNET} lastSpent={null} />);
    const sentence = allowanceSentence(mandate, ARC_TESTNET);
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(`^Ended\\. 30\\.00 USDC left, .*${sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))).toBeInTheDocument();
  });

  it("does not read the figures twice: the drawing is hidden from a screen reader, the sentence is not", () => {
    const mandate = allowance(agent(7), "50", "10", NOW + 86_400);
    const { container } = draw(<AgentGauge mandate={mandate} network={ARC_TESTNET} lastSpent={null} />);
    const hidden = Array.from(container.querySelectorAll("[aria-hidden='true']"));
    expect(hidden.some((node) => node.textContent?.includes("40.00"))).toBe(true);
    expect(hidden.some((node) => node.textContent?.includes(spentLine(mandate, ARC_TESTNET)))).toBe(true);
  });
});
