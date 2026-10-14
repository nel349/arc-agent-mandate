import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { Amount } from "../arc/amount.ts";
import type { Mandate } from "../arc/mandate.ts";
import { draw } from "../test/draw.tsx";
import { AgentNamesProvider } from "./agent-names-context.tsx";
import { AgentRowLive } from "./AgentRowLive.tsx";
import { choiceOf, NETWORK_CHOICE_KEY } from "./network-choice.ts";
import { SessionProvider } from "./session-context.tsx";

const AGENT = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";
const NOW = Math.floor(Date.now() / 1000);
const MANDATE: Mandate = {
  agent: AGENT, limit: Amount.parse("0.01"), spent: Amount.parse("0.002"), remaining: Amount.parse("0.008"),
  expiresAt: NOW + 86_400, agentFloat: Amount.ZERO, escrow: Amount.ZERO, lastUsedAt: null, rail: "native",
};

/**
 * The row inside the real session and the real names, as the home list draws it. With no wallet
 * open the feed is empty, so there is no identity to confirm with the registry and nothing is fetched;
 * confirming one needs the chain, and is the registry read's own business (`useAgentIdentity`).
 */
function drawLive(onPress = vi.fn()) {
  return draw(
    <SessionProvider>
      <AgentNamesProvider>
        <AgentRowLive mandate={MANDATE} name="Runner" onPress={onPress} first />
      </AgentNamesProvider>
    </SessionProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe("an agent row inside the app", () => {
  it("counts in the coin of the network the wallet is on", async () => {
    localStorage.setItem(NETWORK_CHOICE_KEY, choiceOf(MONAD_TESTNET));
    drawLive();
    await waitFor(() => expect(screen.getByRole("button", { name: /0\.008 MON left of 0\.01/ })).toBeInTheDocument());
  });

  it("rests, with no identity line, while the feed has nothing for it, and asks nothing of the network", async () => {
    const fetches = vi.spyOn(globalThis, "fetch");
    drawLive();
    const row = await screen.findByRole("button", { name: /^Runner\./ });
    expect(row.textContent).not.toMatch(/Spending now|ERC-8004/);
    expect(fetches).not.toHaveBeenCalled();
    fetches.mockRestore();
  });

  it("opens the agent when tapped", async () => {
    const onPress = vi.fn();
    drawLive(onPress);
    await userEvent.click(await screen.findByRole("button", { name: /^Runner\./ }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith(AGENT);
  });
});
