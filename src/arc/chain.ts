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
  /** ERC-8004 agent registries. Permissionless: anyone can register an identity or write feedback
   *  about one, so what they hold is a claim to check before any of it is shown to a user. */
  erc8004: {
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  },
  /**
   * Circle's Gateway Wallet, the same address on every chain Gateway supports. An agent's purchase
   * shows on Arc as a deposit into it, credited to the agent and paid for by the account, which is
   * what the payments feed reads. The connector keeps its own copy in `mcp/gateway.ts`, because it
   * is a separate program that imports nothing from the app.
   */
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
} as const;

/**
 * Circle's faucet for test USDC, where the README already sends people, choosing Arc testnet. The
 * first step of the journey is a funded wallet, and this is how a new one gets its first dollars.
 */
export const TESTNET_FAUCET_URL = "https://faucet.circle.com";

/** Blockscout's path for one transaction, under the explorer viem names for this chain. */
const EXPLORER_TX_PATH = "/tx/";

/** Where a person can check a transaction for themselves, on the explorer viem lists for Arc. */
export function explorerTxUrl(hash: string): string {
  return `${arcTestnet.blockExplorers.default.url}${EXPLORER_TX_PATH}${hash}`;
}

/** The path segment Circle's modular RPC expects for this chain, per their own docs. */
export const ARC_TESTNET_TRANSPORT_PATH = "arcTestnet";
