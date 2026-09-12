import { parseAbi, type Address } from "viem";
import { ARC_CONTRACTS } from "./chain.ts";
import { arcPublicClient } from "./client.ts";

/**
 * Reading an agent's ERC-8004 identity, which its owner holds.
 *
 * The identity is what a seller credits: the maze writes a run's reputation against it and pays its
 * badge to whoever owns it. The connector registers one from the wallet at pairing and links the
 * agent's key to it, so the wallet owns the identity and the agent is named as its wallet.
 *
 * There is no reverse lookup on the registry, so the phone cannot ask "which identity is this
 * agent's". It reads the registrations in its own feed and asks the registry about those, which is
 * this one call.
 */

const registryAbi = parseAbi(["function getAgentWallet(uint256 agentId) view returns (address)"]);

/** The key an identity names as its agent wallet, or the zero address when it names none. */
export async function agentWalletOf(agentId: bigint): Promise<Address> {
  return arcPublicClient.readContract({
    address: ARC_CONTRACTS.erc8004.identity, abi: registryAbi, functionName: "getAgentWallet", args: [agentId],
  });
}
