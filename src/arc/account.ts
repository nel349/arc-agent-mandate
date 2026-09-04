import { createPublicClient, http, type Address } from "viem";
import { createBundlerClient, type SmartAccount } from "viem/account-abstraction";
import {
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  createRpClient,
  rpActions,
  WebAuthnMode,
} from "@circle-fin/modular-wallets-core";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { arcTestnet, ARC_TESTNET_TRANSPORT_PATH } from "./chain.ts";
import { installWebAuthnShim } from "../passkey/shim.ts";

/**
 * Bringing a passkey-backed Circle smart account up on Arc.
 *
 * The split is worth naming, because it is not obvious from Circle's docs: **Circle supplies the
 * identity and the account; viem supplies everything that sends a transaction.** Circle's
 * TypeScript SDK has no `sendUserOperation`, no `encodeFunctionData`, no bundler actions at all.
 * That is not a gap — viem's account-abstraction layer is richer than the one Circle ships
 * natively, and it behaves identically on both platforms.
 */

export interface ArcAccountConfig {
  readonly clientKey: string;
  /** Must match the passkey domain registered in the Circle Console — Circle validates the
   *  client key against it via `X-AppInfo`. See `installWebAuthnShim`. */
  readonly passkeyDomain: string;
  /** Circle's modular RPC base. The chain path is appended, never baked into the env var. */
  readonly clientUrl: string;
  readonly username: string;
}

export interface ArcAccount {
  readonly address: Address;
  readonly smartAccount: SmartAccount;
  readonly bundler: ReturnType<typeof createBundlerClient>;
}

/** Reads Arc directly, bypassing Circle. Balances and deployment checks do not need a bundler. */
export const arcPublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(arcTestnet.rpcUrls.default.http[0]),
});

/**
 * Registers a new passkey, or signs in with an existing one, and returns the smart account.
 *
 * The account is **lazily deployed** — it has an address immediately, and the contract is only
 * created by the first user operation. So `address` being funded before any send is normal, and
 * `isDeployed()` returning false is not an error.
 */
export async function connectArcAccount(
  config: ArcAccountConfig,
  mode: WebAuthnMode = WebAuthnMode.Register,
): Promise<ArcAccount> {
  // Circle's SDK reads `window.navigator.credentials` at call time; on React Native nothing
  // provides it until we do. Must precede every call below.
  installWebAuthnShim(config.passkeyDomain);

  const credential = await toWebAuthnCredential({
    transport: toPasskeyTransport(config.clientUrl, config.clientKey),
    username: config.username,
    mode,
  });

  const modularTransport = toModularTransport(
    `${config.clientUrl}/${ARC_TESTNET_TRANSPORT_PATH}`,
    config.clientKey,
  );

  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport });

  const smartAccount = await toCircleSmartAccount({
    client,
    // `rpId` is not optional in practice, only in the type. Registration gets its rpId from
    // Circle's RP options, but **signing** goes through ox's WebAuthnP256, which defaults
    // `rpId` to `window.location.hostname` — the Metro dev server in development, and
    // undefined-ish in a release build. iOS then refuses the assertion:
    //   "Application M569N7RGY6.com.kuiralabs.arcmandate is not associated with domain
    //    192.168.1.219"
    // So registration succeeds and every later signature fails, which is a confusing shape of
    // bug. Pin it to the passkey domain the credential was actually created against.
    owner: toWebAuthnAccount({ credential, rpId: config.passkeyDomain }),
  });

  const bundler = createBundlerClient({
    account: smartAccount,
    chain: arcTestnet,
    transport: modularTransport,
    // Sponsorship. Note that on Arc this is the paymaster's *only* remaining job — "pay gas in
    // USDC" is not a feature here, because gas already is USDC.
    paymaster: true,
  });

  return { address: smartAccount.address, smartAccount, bundler };
}

/** Whether the account contract exists yet. False before the first user operation is expected. */
export async function isDeployed(address: Address): Promise<boolean> {
  const code = await arcPublicClient.getCode({ address });
  return code !== undefined && code !== "0x";
}

/** Re-exported so callers need not import the SDK directly to choose register vs login. */
export { WebAuthnMode };
