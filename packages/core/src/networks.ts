import type { Address } from "viem";
import type { GasLimits } from "./gas.ts";

/**
 * The networks a mandate works on, each described once.
 *
 * Everything a wallet, a connector or a server needs to know about a network lives in its profile, so
 * adding a network is adding a profile, not a branch in every program. Each address here was checked
 * deployed on its chain by direct `eth_getCode`; the ones that are the same on both networks are the
 * same contracts, placed by deterministic deployment.
 */

/** Which balance a mandate's limit meters. */
export type Meter =
  /** the ERC-20 view of the chain's own coin, so payments and escrow approvals share one limit (Arc, where the coin is USDC) */
  | "erc20View"
  /** the chain's own coin, carried as a call's value, so a limit can also name who may be paid (Monad's MON) */
  | "native";

export interface NetworkProfile {
  /** the name Circle's bundler and paymaster know the network by, in the path of its endpoint */
  readonly circlePath: string;
  readonly chainId: number;
  readonly name: string;
  readonly rpc: string;
  readonly explorer: string;
  /** what the explorer is called, for a link that opens it */
  readonly explorerName: string;
  /** where test money for this network is handed out */
  readonly faucet: string;
  /** the chain's own coin, which pays for whatever a mandate allows when it meters natively; `dollar` when it is one */
  readonly coin: { readonly symbol: string; readonly decimals: number; readonly dollar: boolean };
  readonly meter: Meter;
  readonly contracts: {
    /** ERC-4337 EntryPoint v0.7, which Circle's accounts run */
    readonly entryPoint: Address;
    /** the session-key plugin, ours, which holds and enforces a mandate's limits */
    readonly sessionKeyPlugin: Address;
    /** Circle's owner plugin on its modular accounts: the passkey, or a plain key */
    readonly ownerPlugin: Address;
    /** Circle's paymaster, which sponsors the gas of a wallet's and an agent's operations */
    readonly paymaster: Address;
    /** the maze's Cohort Zero badge, minted to whoever owns an agent's identity when its work earns one, on the network it is on */
    readonly cohortBadge?: Address;
    /** Circle's Gateway Wallet, where an agent's escrow for paying x402 sellers is kept, on a network Gateway serves */
    readonly gatewayWallet?: Address;
    /** the ERC-20 view of the chain's own coin, on a network that has one, which a grant naming no payees meters */
    readonly erc20View?: { readonly address: Address; readonly decimals: number };
    readonly erc8004: { readonly identity: Address; readonly reputation: Address; readonly validation: Address };
  };
  /**
   * How the chain's event logs are searched, which is how an agent finds the grant carrying its code and
   * how the wallet shows what its agents did.
   */
  readonly logs: {
    /** the most a query's last block may be past its first, as the network's public node allows */
    readonly window: bigint;
    /** how far back to look for a grant when it is not known when the code was shown */
    readonly recent: bigint;
    /** the block the session-key plugin was deployed in: no grant, and nothing an agent did, is older */
    readonly floor: bigint;
    /**
     * The wallet's feed of what its agents did: how many blocks it reads at first and each time a person
     * asks for earlier, and how far behind it may fall and still catch up rather than start again from
     * the latest (none: it always catches up).
     */
    readonly feed: { readonly span: bigint; readonly mostBehind: bigint | null };
  };
  /**
   * The gas an operation starts from on this network's bundler, corrected from what the bundler names
   * when it refuses (gas.ts). An agent's payment cannot be estimated, so these are where it starts.
   */
  readonly gas: {
    /** an agent's payment, signed by its session key */
    readonly agent: GasLimits;
    /** the owner's operation that makes the wallet if need be and grants the mandate */
    readonly grant: GasLimits;
    /**
     * Whether the owner's operations are priced by asking the bundler. Arc's estimates them; on Monad
     * they start from `grant` and are corrected from what the bundler names, with a doubled bid, as
     * proven there.
     */
    readonly estimatesOwnerOperations: boolean;
  };
}

/** The gas the paymaster spends checking and settling its sponsorship, the same on both networks. */
const PAYMASTER_GAS = { paymasterVerificationGasLimit: 150_000n, paymasterPostOpGasLimit: 20_000n } as const;

/** The same contracts on every network a mandate runs on, placed there deterministically. */
const SHARED = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  sessionKeyPlugin: "0x669Dd1eDb85ABD00f74186d88124614EE81E6670",
  ownerPlugin: "0x0000000C984AFf541D6cE86Bb697e68ec57873C8",
  paymaster: "0x03dF76C8c30A88f424CF3CBBC36A1Ca02763103b",
  erc8004: {
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  },
} as const;

export const ARC_TESTNET: NetworkProfile = {
  circlePath: "arcTestnet",
  chainId: 5042002,
  name: "Arc testnet",
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  explorerName: "ArcScan",
  faucet: "https://faucet.circle.com",
  // Arc's own coin is USDC, at 18 decimals natively and 6 through its ERC-20 view
  coin: { symbol: "USDC", decimals: 18, dollar: true },
  meter: "erc20View",
  contracts: {
    ...SHARED,
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    cohortBadge: "0xe5A8fAEf7139d04582C7E17C3F615710343b53a3",
    erc20View: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  },
  // the feed reads a day at a time, about 1.95 blocks a second, and catches up however long the app was away
  logs: { window: 9_999n, recent: 29_997n, floor: 60_625_268n, feed: { span: 167_669n, mostBehind: null } },
  gas: {
    // what the connector has sent for every payment on Arc; Arc's bundler takes generous limits
    agent: { callGasLimit: 500_000n, verificationGasLimit: 500_000n, preVerificationGas: 100_000n, ...PAYMASTER_GAS },
    grant: { callGasLimit: 1_500_000n, verificationGasLimit: 1_500_000n, preVerificationGas: 150_000n, ...PAYMASTER_GAS },
    estimatesOwnerOperations: true,
  },
};

export const MONAD_TESTNET: NetworkProfile = {
  circlePath: "monadTestnet",
  chainId: 10143,
  name: "Monad testnet",
  rpc: "https://testnet-rpc.monad.xyz",
  explorer: "https://testnet.monadexplorer.com",
  explorerName: "Monad Explorer",
  faucet: "https://faucet.monad.xyz",
  coin: { symbol: "MON", decimals: 18, dollar: false },
  meter: "native",
  contracts: SHARED,
  // its public node refuses a query spanning more than 100 blocks, and makes about two a second, so
  // looking back half an hour is some 3,600 blocks
  // and the feed reads half an hour at a time; away longer, it starts again from the last half hour
  // rather than read every block since, a hundred at a time, oldest first
  logs: { window: 100n, recent: 3_600n, floor: 67_993_106n, feed: { span: 3_600n, mostBehind: 3_600n } },
  gas: {
    // the figures a payment and a grant landed with on Monad testnet, 3 Oct: Monad bills the whole limit,
    // so its bundler wants preVerificationGas in the millions and a verification limit mostly used
    agent: { callGasLimit: 500_000n, verificationGasLimit: 310_000n, preVerificationGas: 1_300_000n, ...PAYMASTER_GAS },
    grant: { callGasLimit: 1_500_000n, verificationGasLimit: 1_500_000n, preVerificationGas: 3_520_000n, ...PAYMASTER_GAS },
    estimatesOwnerOperations: false,
  },
};

export const NETWORKS: readonly NetworkProfile[] = [ARC_TESTNET, MONAD_TESTNET];

/** The profile of the network with this chain id, if a mandate runs on it. */
export const networkByChainId = (chainId: number): NetworkProfile | undefined =>
  NETWORKS.find((network) => network.chainId === chainId);
