import { createPublicClient, type Address, type Hex } from "viem";
// Re-exported so callers keep one import site. The client itself lives in `client.ts`, which has
// no React Native in its import graph and can therefore be reached from tests and scripts.
export { arcPublicClient, isDeployed } from "./client.ts";
import { createBundlerClient, type SmartAccount } from "viem/account-abstraction";
import {
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  WebAuthnMode,
} from "@circle-fin/modular-wallets-core";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { arcTestnet, ARC_TESTNET_TRANSPORT_PATH } from "./chain.ts";
import { installWebAuthnShim, withReturningUserSignIn } from "../passkey/shim.ts";

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

/**
 * The public half of a passkey: what identifies it, and what checks its signatures.
 *
 * Enough to rebuild the account without asking the passkey anything, which is how the app reopens a
 * wallet at launch. Neither value can sign; the private key never leaves the Secure Enclave.
 */
export interface PasskeyCredential {
  readonly id: string;
  readonly publicKey: Hex;
}

export interface ArcAccount {
  readonly address: Address;
  readonly smartAccount: SmartAccount;
  readonly bundler: ReturnType<typeof createBundlerClient>;
  /** The passkey behind it, public half only, so the wallet can be reopened without a ceremony. */
  readonly credential: PasskeyCredential;
}

/** How to reach Circle, without the name a new passkey is registered under. */
export type ArcConnection = Omit<ArcAccountConfig, "username">;

/**
 * Registers a new passkey, or signs in with an existing one, and returns the smart account.
 *
 * The account is **lazily deployed** — it has an address immediately, and the contract is only
 * created by the first user operation. So `address` being funded before any send is normal, and
 * `isDeployed()` returning false is not an error.
 *
 * `returningUser` makes the sign-in iOS's returning-user request: the passkey sheet appears only if
 * a passkey for this app is already on the phone, and otherwise the call fails without showing
 * anything. It is how the app offers the existing passkey at launch after a reinstall.
 */
export async function connectArcAccount(
  config: ArcAccountConfig,
  mode: WebAuthnMode = WebAuthnMode.Register,
  options: { readonly returningUser?: boolean } = {},
): Promise<ArcAccount> {
  // Circle's SDK reads `window.navigator.credentials` at call time; on React Native nothing
  // provides it until we do. Must precede every call below.
  installWebAuthnShim(config.passkeyDomain);

  const ceremony = () => toWebAuthnCredential({
    transport: toPasskeyTransport(config.clientUrl, config.clientKey),
    username: config.username,
    mode,
  });
  const credential = options.returningUser === true ? await withReturningUserSignIn(ceremony) : await ceremony();

  return accountFor(config, { id: credential.id, publicKey: credential.publicKey });
}

/**
 * Reopens a wallet from its remembered passkey, with no ceremony at all.
 *
 * The account is a function of the credential, so the same id and public key give the same account
 * at the same address every time. Face ID is still asked for whenever anything is signed, because
 * signing goes to the passkey; opening the wallet does not.
 */
export async function reopenArcAccount(config: ArcConnection, credential: PasskeyCredential): Promise<ArcAccount> {
  // Signing later reaches for `navigator.credentials`, so the shim is needed even with no ceremony now.
  installWebAuthnShim(config.passkeyDomain);
  return accountFor(config, credential);
}

/** The account a credential opens. One wiring, for a new sign-in and a reopened wallet alike. */
async function accountFor(config: ArcConnection, credential: PasskeyCredential): Promise<ArcAccount> {
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

  return { address: smartAccount.address, smartAccount, bundler, credential };
}

/** Re-exported so callers need not import the SDK directly to choose register vs login. */
export { WebAuthnMode };
