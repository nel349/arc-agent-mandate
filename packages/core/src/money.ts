import { formatUnits } from "viem";
import type { NetworkProfile } from "./networks.ts";

/**
 * An amount of a network's coin, the way a person reads it: in dollars where the coin is one (Arc's
 * USDC), and named otherwise (Monad's MON), so nobody is told they paid a dollar figure in MON.
 */
export const amountIn = (network: NetworkProfile, units: bigint): string => {
  const amount = formatUnits(units, network.coin.decimals);
  return network.coin.dollar ? `$${amount}` : `${amount} ${network.coin.symbol}`;
};
