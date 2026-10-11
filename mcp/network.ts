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

/**
 * Where the owner's wallet opens: the Mandate, built for the web, on the domain the shared testnet
 * key is bound to. One address, whatever network the agent is on.
 *
 * There were two for a while. The wallet at this address ran on Arc only, and the one that also ran
 * on Monad was published beside it at `/mandate-next/` until it took this one's place, which it did
 * on 11 October 2026. In between, a person on Monad sent here found an app that could not see their
 * agent's code, so the connector chose by network. `/mandate-next/` now sends whoever opens it here.
 */
export const WALLET_URL = "https://kuiralabs.github.io/mandate/";
