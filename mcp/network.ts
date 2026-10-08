import { ARC_TESTNET, NETWORKS, type NetworkProfile } from "@kuiralabs/mandate-core";

/**
 * Which network this connector spends on, named the way Circle names it: `arcTestnet`, the default, or
 * `monadTestnet`. One install serves either; the profile says everything that differs between them.
 */
export const NETWORK_SETTING = "ARC_MANDATE_NETWORK";

/** The network a name means, Arc when none is given, and a refusal naming the choices for one it does not know. */
export function networkNamed(name: string | undefined): NetworkProfile {
  if (name === undefined || name.trim() === "") return ARC_TESTNET;
  const found = NETWORKS.find((network) => network.circlePath === name.trim());
  if (found === undefined) {
    throw new Error(`${NETWORK_SETTING}=${name} is not a network this connector knows. It knows ${NETWORKS.map((network) => network.circlePath).join(" and ")}.`);
  }
  return found;
}

/** The network this connector was started for, read once from its environment. */
export const NETWORK: NetworkProfile = networkNamed(process.env[NETWORK_SETTING]);

/** The wallet as it is published, which runs on Arc. */
const WALLET_PUBLISHED = "https://kuiralabs.github.io/mandate/";
/** The wallet that also runs on Monad, published beside the other until it takes its place. */
const WALLET_NEXT = "https://kuiralabs.github.io/mandate-next/";

/**
 * Where the owner's wallet opens for a network: the Agent Mandate app, built for the web, on the
 * domain the shared testnet key is bound to.
 *
 * The network decides, because the published wallet does not run on every network the connector
 * does. A person on Monad sent to the published one found an app that could not see their agent's
 * code (8 October 2026), and nothing told them why.
 */
export function walletFor(network: NetworkProfile): string {
  return network === ARC_TESTNET ? WALLET_PUBLISHED : WALLET_NEXT;
}
