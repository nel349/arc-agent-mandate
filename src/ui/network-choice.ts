import { ARC_TESTNET, NETWORKS, type NetworkProfile } from "@kuiralabs/mandate-core";

/**
 * Which network the wallet shows, chosen on Home and remembered on the phone. The same passkey opens the
 * same wallet on every network, so this is only which one's balance and agents are on screen.
 */
export const NETWORK_CHOICE_KEY = "arc.network";

/** The network a stored choice names: Arc for none, or for one this build no longer knows. */
export const networkOfChoice = (stored: string | null): NetworkProfile =>
  NETWORKS.find((network) => network.circlePath === stored) ?? ARC_TESTNET;

/** What is stored for a network: the name Circle knows it by. */
export const choiceOf = (network: NetworkProfile): string => network.circlePath;

/**
 * The networks to try reopening the remembered wallet on, in order: the one chosen, then Arc.
 *
 * The same passkey opens the same address on every network, so a different address on the chosen one
 * says that network's wallet is not the one remembered. Arc, where every wallet began, is tried before
 * the memory is given up on, so a choice can never cost a person their wallet.
 */
export const reopenOrder = (chosen: NetworkProfile): readonly NetworkProfile[] =>
  chosen.chainId === ARC_TESTNET.chainId ? [ARC_TESTNET] : [chosen, ARC_TESTNET];

/** Said when a network would open this passkey at another address, so the wallet stays where it was. */
export const anotherAddressOn = (network: NetworkProfile): string =>
  `This passkey opens a different address on ${network.name}, so your wallet stayed where it was.`;

/** "Monad testnet" as "Monad": the part that tells networks apart, since "testnet" is on every one. */
export const shortNameOf = (network: NetworkProfile): string => network.name.replace(/\s+testnet$/i, "");
