import { arcTestnet } from "viem/chains";

/**
 * Arc chain configuration.
 *
 * The chain itself comes from **viem**, not from us. An earlier version hand-rolled it before
 * noticing `viem/chains` already exports `arcTestnet` — theirs carries three RPC endpoints with
 * fallback (ours had one) and a `multicall3` entry, and it is maintained upstream. Both
 * `rpc.testnet.arc.io` and `rpc.testnet.arc.network` answer with chain id `0x4cef52`; viem uses
 * the latter.
 *
 * Mainnet is **not** re-exported. Circle's iOS SDK defines `Arc` as chain id `5042`, their
 * Android SDK defines no such chain, and Modular Wallets supports testnet only — so mainnet is
 * staged rather than shipped, and importing it here would imply otherwise.
 */
export { arcTestnet };

/**
 * Arc-specific contracts this app builds on. Each verified deployed on testnet by direct
 * `eth_getCode`. viem's chain definition carries only `multicall3`, so these stay ours.
 */
export const ARC_CONTRACTS = {
  /** The ERC-20 view over the native USDC balance. 6 decimals, and it truncates — see usdc.ts. */
  usdc: "0x3600000000000000000000000000000000000000",
  /** Attaches a memo to a call and emits it with a sequential index. */
  memo: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
  /** Batches calls while preserving the original `msg.sender` in each subcall, unlike Multicall3. */
  multicall3From: "0x522fAf9A91c41c443c66765030741e4AaCe147D0",
  /** ERC-8004 agent registries. Permissionless — see agent-mandate/PRODUCT.md on what they do
   *  and do not guarantee before showing anything from them to a user. */
  erc8004: {
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  },
} as const;

/** The path segment Circle's modular RPC expects for this chain, per their own docs. */
export const ARC_TESTNET_TRANSPORT_PATH = "arcTestnet";
