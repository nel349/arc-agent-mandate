import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { Activity } from "../arc/activity.ts";
import { agentWalletOf } from "../arc/identity.ts";

/**
 * The ERC-8004 identity this agent set up, or `null` while there is none to show.
 *
 * The feed knows which identities were minted to this wallet and which agent's operation minted each
 * one. That is where the number comes from. What the feed cannot say is whether the identity still
 * names this agent as its wallet — an owner can move an identity, and a transfer clears that — so
 * each candidate is confirmed with the registry before it is shown, newest first.
 *
 * Kept out of the screen so the screen renders a number or nothing, and never a claim it has not
 * checked. A registry that will not answer shows nothing, which is what the screen said before.
 */
export function useAgentIdentity(agent: Address | null, items: readonly Activity[]): bigint | null {
  const [identity, setIdentity] = useState<bigint | null>(null);

  // Newest first, as the feed is ordered: the identity an agent is on now is the last it registered.
  // `flatMap` rather than a filter and a cast: the guard that drops a row with no number is the same
  // step that narrows the type, so nothing has to be asserted afterwards.
  const candidates = agent === null
    ? []
    : items.flatMap((item) =>
      item.kind === "registered" && item.identity !== undefined
        && item.agent.toLowerCase() === agent.toLowerCase()
        ? [item.identity]
        : []);
  /** The candidates as one value, so the effect below runs when they change and not on every render. */
  const candidateKey = candidates.join(",");

  useEffect(() => {
    let current = true;
    setIdentity(null);
    if (agent === null || candidateKey === "") return;
    void (async () => {
      for (const agentId of candidateKey.split(",").map(BigInt)) {
        try {
          const wallet = await agentWalletOf(agentId);
          if (!current) return;
          if (wallet.toLowerCase() === agent.toLowerCase()) {
            setIdentity(agentId);
            return;
          }
        } catch {
          // The registry did not answer. Nothing is shown, which is where the screen started.
          return;
        }
      }
    })();
    return () => { current = false; };
  }, [agent, candidateKey]);

  return identity;
}
