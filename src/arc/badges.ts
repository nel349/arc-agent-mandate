import { parseAbi, type Address } from "viem";
import { ARC_CONTRACTS } from "./chain.ts";
import { arcPublicClient } from "./client.ts";

/**
 * The badges a wallet has been given, read from the cohort's own contract.
 *
 * A badge is what an agent's work earns its owner: the maze mints one to whoever holds the agent's
 * ERC-8004 identity, and refuses to mint a second to the same holder. It is the only thing in this
 * app that is *earned* rather than granted, spent or read, and until now the phone never showed it.
 *
 * **Finding a holder's badge without an index.** The contract is a plain ERC-721 with no
 * enumeration, so there is no "tokens of owner" to ask for. What it does have is a fixed cohort and
 * a count of what is left, which together say exactly which numbers exist: the cohort is a hundred
 * places and they are handed out in order. So the numbers are known, and `ownerOf` answers each. One
 * badge per holder is the contract's own rule, so the search stops at the first match.
 *
 * That is a read per minted badge in the worst case, and the cohort's size is the ceiling: a hundred
 * for ever. `hasBadge` is asked first, so a wallet with nothing costs exactly one read.
 */

const badgeAbi = parseAbi([
  "function hasBadge(address holder) view returns (bool)",
  "function remaining() view returns (uint256)",
  "function COHORT_SIZE() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

export interface Badge {
  /** Its number in the cohort, which is also its token id. */
  readonly number: number;
  /** Where the badge describes itself, which is the address its `tokenURI` gives. */
  readonly uri: string;
}

/**
 * The numbers that exist, from the cohort's size and what is left of it.
 *
 * Badges are handed out in order from one, so this is exact rather than a guess, and it is the whole
 * reason a holder's badge can be found without an index.
 */
export function mintedNumbers(cohortSize: bigint, remaining: bigint): number[] {
  const minted = cohortSize > remaining ? Number(cohortSize - remaining) : 0;
  return Array.from({ length: minted }, (_, index) => index + 1);
}

/** The first number whose owner is this wallet, or `null`. Addresses compare without case. */
export function heldBy(owners: readonly (readonly [number, Address])[], wallet: Address): number | null {
  const who = wallet.toLowerCase();
  for (const [number, owner] of owners) {
    if (owner.toLowerCase() === who) return number;
  }
  return null;
}

/**
 * How many badges to ask about before giving up and answering "none".
 *
 * `hasBadge` is the contract's record of having been *minted* one, and an ERC-721 transfer moves
 * `ownerOf` without clearing it. So a wallet that minted a badge and gave it away answers yes here
 * and owns none, which would walk the whole cohort one read at a time against an endpoint that
 * already rate-limits. The walk is bounded, and an empty answer stands.
 */
const MOST_TO_WALK = 25;

/**
 * The badge this wallet holds, or nothing. One per holder is the contract's own rule.
 *
 * One read when it holds none. Otherwise a read for the cohort's shape and one per minted badge
 * until its own is found, then one more for where the badge describes itself.
 */
export async function badgesOf(wallet: Address): Promise<Badge[]> {
  // Spread into each call rather than wrapped in a helper: a helper taking a name and arguments has
  // to be cast to satisfy it, and a cast here would hide a wrong name or wrong arguments entirely.
  const badge = { address: ARC_CONTRACTS.cohortBadge, abi: badgeAbi } as const;

  if (!(await arcPublicClient.readContract({ ...badge, functionName: "hasBadge", args: [wallet] }))) return [];

  const [cohortSize, remaining] = await Promise.all([
    arcPublicClient.readContract({ ...badge, functionName: "COHORT_SIZE" }),
    arcPublicClient.readContract({ ...badge, functionName: "remaining" }),
  ]);
  const owners: [number, Address][] = [];
  for (const number of mintedNumbers(cohortSize, remaining).slice(0, MOST_TO_WALK)) {
    owners.push([number, await arcPublicClient.readContract({ ...badge, functionName: "ownerOf", args: [BigInt(number)] })]);
    if (heldBy(owners, wallet) !== null) break;
  }
  const number = heldBy(owners, wallet);
  if (number === null) return [];
  return [{
    number,
    uri: await arcPublicClient.readContract({ ...badge, functionName: "tokenURI", args: [BigInt(number)] }),
  }];
}
