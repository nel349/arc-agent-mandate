import { parseUnits, type Address } from "viem";
import type { NetworkProfile } from "@kuiralabs/mandate-core";

/**
 * Circle's own figure for an agent's escrow: shared by the connector and the app.
 *
 * Kept apart from `gateway.ts`, which reads files and the agent's key and so cannot be bundled into
 * the app. This needs only `fetch`, which both have, and Circle's service answers any web page.
 */

/**
 * Circle's Gateway service, which keeps the balances x402 payments are checked against: one for real
 * money and one for test money. It was the testnet one alone, so on Arc mainnet an agent's escrow was
 * asked of a service that has never heard of it.
 */
const GATEWAY_API = { live: "https://gateway-api.circle.com", test: "https://gateway-api-testnet.circle.com" } as const;
export const gatewayApiFor = (network: Pick<NetworkProfile, "live">): string => (network.live ? GATEWAY_API.live : GATEWAY_API.test);
/** Arc's number among Gateway's chains, as `GET /v1/info` lists it: 26 on mainnet and on testnet alike. */
const ARC_DOMAIN = 26;
/**
 * What Circle says the agent holds, at ERC-20 scale: the figure a payment is checked against.
 *
 * The two disagree both ways. Circle credits a deposit a moment after the chain records it, so a
 * payment sent in between is refused although the money is there. And the chain still counts
 * payments Circle has accepted and not yet settled, so it overstates what is left: on 1 October it
 * said $1.476 for an agent Circle held $0.166 for.
 */
export async function circleEscrow(agentAddress: Address, network: Pick<NetworkProfile, "live">): Promise<bigint> {
  const res = await fetch(`${gatewayApiFor(network)}/v1/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: ARC_DOMAIN, depositor: agentAddress }] }),
  });
  if (!res.ok) throw new Error(`Gateway's balance service answered ${res.status}`);
  const body = (await res.json()) as { balances?: { balance?: string }[] };
  const balance = body.balances?.[0]?.balance;
  if (balance === undefined) throw new Error("Gateway's balance service named no balance");
  return parseUnits(balance, 6);
}
