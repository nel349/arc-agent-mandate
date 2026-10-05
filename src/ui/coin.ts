import type { NetworkProfile } from "@kuiralabs/mandate-core";
import type { Amount } from "../arc/amount.ts";

/**
 * Amounts as the screens show them, in the coin of the network the wallet is open on.
 *
 * Pure and apart from the screens, so a figure reads the same wherever it is shown, and the network,
 * not each screen, decides what the money is called.
 */

/**
 * An amount at the precision it actually has: at least two places, and as many more as it needs.
 *
 * An agent pays by the step, a tenth of a cent at a time, and two places rounded every one of those
 * down to "0.00", which is a row claiming nothing moved. Six places on everything would be noise
 * the other way. So: "0.001", "0.28", "12.00".
 */
export function formatAmount(amount: Amount): string {
  const [whole, fraction = ""] = amount.format(6).split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

/**
 * A balance or a limit, as the big figures show it: cents for a coin that is a dollar, since nobody
 * counts dollars in thousandths, and every place it needs for any other, since a limit of 0.005 MON
 * shown to two places would read as 0.01, twice what was granted.
 */
export function figure(amount: Amount, network: NetworkProfile): string {
  return network.coin.dollar ? amount.format(2) : formatAmount(amount);
}

/** What the money is called beside a figure: USDC on Arc, MON on Monad. */
export const unitOf = (network: NetworkProfile): string => network.coin.symbol;

/** A figure with its unit, for a sentence: "20.00 USDC", "0.005 MON". */
export const inCoin = (amount: Amount, network: NetworkProfile): string => `${figure(amount, network)} ${unitOf(network)}`;
