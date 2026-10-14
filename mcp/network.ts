import { ARC_MAINNET, ARC_TESTNET, NETWORKS, type NetworkProfile } from "@kuiralabs/mandate-core";

/**
 * Which network this connector spends on, named the way Circle names it: `arcTestnet`, the default,
 * `monadTestnet`, or `arc` for Arc mainnet, which is real money. One install serves any of them; the
 * profile says everything that differs between them.
 */
export const NETWORK_SETTING = "ARC_MANDATE_NETWORK";

/** The network a name means, Arc when none is given, and a refusal naming the choices for one it does not know. */
export function networkNamed(name: string | undefined): NetworkProfile {
  if (name === undefined || name.trim() === "") return ARC_TESTNET;
  const found = NETWORKS.find((network) => network.circlePath === name.trim());
  if (found === undefined) {
    throw new Error(`${NETWORK_SETTING}=${name} is not a network this connector knows. It knows ${NETWORKS.map((network) => network.circlePath).join(", ")}.`);
  }
  return found;
}

/**
 * The words the connector can be started with instead of the setting, so a line that installs it for
 * real money is the testnet line and one word: `npx -y @kuiralabs/arc-mandate mainnet`.
 */
const NETWORK_WORDS: Readonly<Record<string, NetworkProfile>> = { mainnet: ARC_MAINNET, testnet: ARC_TESTNET };

/**
 * The network a start asks for: a word after the command if there is one, else the setting. A word it
 * does not know is refused, naming the words it does, rather than quietly starting on testnet.
 */
export function networkStarted(args: readonly string[], setting: string | undefined): NetworkProfile {
  const word = args.find((arg) => !arg.startsWith("-"));
  if (word === undefined) return networkNamed(setting);
  const named = NETWORK_WORDS[word.trim().toLowerCase()];
  if (named === undefined) {
    throw new Error(`"${word}" is not a network this connector knows. Start it with ${Object.keys(NETWORK_WORDS).join(" or ")}, or with nothing for Arc testnet.`);
  }
  return named;
}

/** The network this connector was started for, read once from how it was started. */
export const NETWORK: NetworkProfile = networkStarted(process.argv.slice(2), process.env[NETWORK_SETTING]);

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

/**
 * The wallet, told which network to open on, as each gym links it: a phone that last showed testnet,
 * or a fresh one, would otherwise open the test wallet for an agent that spends real money.
 */
export function walletOn(network: NetworkProfile): string {
  const url = new URL(WALLET_URL);
  url.searchParams.set("network", network.circlePath);
  return url.toString();
}
