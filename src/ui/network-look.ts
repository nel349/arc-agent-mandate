import { ARC_TESTNET, MONAD_TESTNET, type NetworkProfile } from "@kuiralabs/mandate-core";

/**
 * The one colour each network brings to an otherwise graphite app.
 *
 * Everything else on screen is ink on near-black, so a colour always means a network: the edge of an
 * allowance card, the mark beside its name. Here, apart from the profiles, because a colour is how
 * this app draws a network and not a fact about the chain.
 */
const ACCENTS: ReadonlyMap<number, string> = new Map([
  /** Monad's own purple */
  [MONAD_TESTNET.chainId, "#836EF9"],
  /** the blue Arc's actions are drawn in */
  [ARC_TESTNET.chainId, "#5FBFFF"],
]);

/** A network this build has no colour for yet: a neutral one, so it is never mistaken for another. */
const NEUTRAL = "#B3AFA7";

export const accentOf = (network: NetworkProfile): string => ACCENTS.get(network.chainId) ?? NEUTRAL;
