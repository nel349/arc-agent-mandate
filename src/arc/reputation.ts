import { parseAbi, type Address } from "viem";
import { ARC_CONTRACTS } from "./chain.ts";
import { arcPublicClient } from "./client.ts";

/**
 * What other people have said about an agent, from Arc's ERC-8004 reputation registry.
 *
 * The registry refuses feedback from an agent's own owner or operators, so nothing here can have
 * been written by the wallet reading it. That is what makes it worth showing at all: a number an
 * agent could award itself would say nothing.
 *
 * **Read through the registry's getters, never its logs.** Everything below is an `eth_call`, which
 * every endpoint answers. The same records are also emitted as events, and reading them that way
 * would be fewer round trips — but a log query spans blocks, and a provider's free plan refuses a
 * span wider than ten. See `src/arc/endpoint.ts`. The cost of getters is a handful of small reads
 * that work everywhere, which is the right trade for a screen.
 *
 * What the getters do not carry is the `feedbackURI` — the run a score came from lives in the event
 * only. So a score here names the game that wrote it rather than linking to the individual run.
 */

const registryAbi = parseAbi([
  "function getClients(uint256 agentId) view returns (address[])",
  "function getLastIndex(uint256 agentId, address client) view returns (uint64)",
  "function readFeedback(uint256 agentId, address client, uint64 index) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
]);

/** One thing somebody said about an agent, and who said it. */
export interface Feedback {
  /** Who wrote it. Never the agent's owner: the registry rejects that. */
  readonly client: Address;
  /** The score, before its decimal places are applied. */
  readonly value: number;
  readonly decimals: number;
  /** What the score is about — the maze writes `arc-maze`. */
  readonly tag1: string;
  /** The units, stated on chain so a later reader never has to guess what 100 meant. */
  readonly tag2: string;
}

/**
 * Feedback is numbered from one.
 *
 * Measured, not assumed: `readFeedback(agentId, client, 0)` reverts with `index must be > 0`, so a
 * loop starting at zero reads nothing and reports an agent with a perfect score as having none.
 */
export const FIRST_INDEX = 1n;

/** Enough to show that an agent has a record, without a screen asking the chain twenty times. */
export const MOST_TO_READ = 5;

/**
 * The newest few indices, newest first, for a client whose last index is `lastIndex`.
 *
 * Pure, so the arithmetic that decides what is read is tested without a chain — the off-by-one here
 * is the difference between showing an agent's latest score and showing nothing at all.
 */
export function newestIndices(lastIndex: bigint, most: number = MOST_TO_READ): readonly bigint[] {
  const wanted: bigint[] = [];
  for (let index = lastIndex; index >= FIRST_INDEX && wanted.length < most; index--) {
    wanted.push(index);
  }
  return wanted;
}

/**
 * Everything said about one agent, newest first, skipping anything withdrawn.
 *
 * A revoked record is not a record: the writer took it back, and showing it would be reporting a
 * reputation its author has disowned.
 */
export async function reputationOf(agentId: bigint): Promise<readonly Feedback[]> {
  const registry = ARC_CONTRACTS.erc8004.reputation;
  const clients = await arcPublicClient.readContract({
    address: registry, abi: registryAbi, functionName: "getClients", args: [agentId],
  });

  const said: Feedback[] = [];
  for (const client of clients) {
    const lastIndex = await arcPublicClient.readContract({
      address: registry, abi: registryAbi, functionName: "getLastIndex", args: [agentId, client],
    });
    for (const index of newestIndices(lastIndex)) {
      const [value, decimals, tag1, tag2, revoked] = await arcPublicClient.readContract({
        address: registry, abi: registryAbi, functionName: "readFeedback", args: [agentId, client, index],
      });
      if (revoked) continue;
      said.push({ client, value: Number(value), decimals, tag1, tag2 });
    }
  }
  return said;
}
