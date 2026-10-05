import { defineChain, type Chain } from "viem";
import type { NetworkProfile } from "./networks.ts";

/**
 * A network as viem describes a chain, built from its profile, so a client, an account or a bundler can
 * be made for any network a mandate runs on without describing it again. viem needs the chain id on a
 * client for anything account-abstraction shaped: an operation's hash is bound to it.
 */
export const chainOf = (network: NetworkProfile): Chain => defineChain({
  id: network.chainId,
  name: network.name,
  nativeCurrency: { name: network.coin.symbol, symbol: network.coin.symbol, decimals: network.coin.decimals },
  rpcUrls: { default: { http: [network.rpc] } },
  blockExplorers: { default: { name: `${network.name} explorer`, url: network.explorer } },
});
