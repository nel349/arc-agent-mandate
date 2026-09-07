import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { toCircleSmartAccount } from "@circle-fin/modular-wallets-core";

/**
 * Can the account be reached without Circle?
 *
 * `PRODUCT.md` claims a non-custodial posture, and "non-custodial but unreachable without a
 * vendor's server" would be a materially weaker promise. So the claim needs a test, not a
 * paragraph.
 *
 * The answer is yes, and the reason is in Circle's own SDK: `toCircleSmartAccount` asks their
 * API for the address only when handed *their* transport, and otherwise falls back to
 * `computeAddress(owner)` — a CREATE2 computation over published constants and the credential's
 * public key. Signing never involved Circle at all; it goes through ox's WebAuthnP256 against
 * our own relying-party domain.
 *
 * Verified once against the live API with a throwaway key: Circle returned byte-identical the
 * address computed here offline. That comparison needs their network and a browser `window`,
 * so what is guarded permanently is the half that must not drift — the derivation itself.
 *
 * **What this test protects.** The address is a pure function of the public key and a set of
 * SDK constants: the factory, the proxy creation code, the MSCA implementation, the multisig
 * plugin and its manifest hash, and a zero salt. An SDK upgrade that changes any of them moves
 * every derived address, and the failure mode is silent and total — funds sit at an address
 * nobody can reach any more. A fixed key pinned to a known address turns that into a red test.
 */

/**
 * A real P-256 point from `crypto.generateKeyPairSync`, not hand-typed hex.
 *
 * Derivation only hashes the coordinates today, so an off-curve value would pass — but a fixture
 * that could never come from an authenticator is one SDK version away from failing for a reason
 * that has nothing to do with what this test is about. Nothing ever signs with it.
 */
const FIXTURE_PUBLIC_KEY: Hex =
  `0x${"048554b405f1ea88febd4fa83afebab3960471578b2d744c7f5394433135c8035"}${
    "0695ccd503535b5b37cea94b463c0c5e8c3163eff89425669712a08fd90fcad6d"}`;

/** Recorded from the SDK version this repo pins. A change here is a recovery-breaking change. */
const EXPECTED_ADDRESS: Address = "0x5371d1f7eDfd0c6783B3A8305B2836D83796F6c2";

/**
 * Minimal, and never dialled. `getAddress` on this path is a pure computation — no anvil, no
 * network, and the client is here only because the SDK's signature asks for one.
 */
const arc = {
  id: 5042002,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
};

const accountFor = (publicKey: Hex) =>
  toCircleSmartAccount({
    // Deliberately a plain RPC, not Circle's modular transport. That is the whole point: this
    // path never calls them.
    client: createPublicClient({ chain: arc, transport: http() }),
    owner: toWebAuthnAccount({ credential: { id: "fixture", publicKey } }),
  });

test("the account address derives from the credential alone, with no Circle transport", async () => {
  const account = await accountFor(FIXTURE_PUBLIC_KEY);
  assert.equal(
    await account.getAddress(),
    EXPECTED_ADDRESS,
    "Address derivation changed. Every existing account is now unreachable — check whether " +
    "@circle-fin/modular-wallets-core moved the factory, the MSCA implementation or the salt.",
  );
});

test("a different credential is a different account", async () => {
  const other = await accountFor(
    `0x${"04bd4a1b3f9e0d2c8a7f6e5d4c3b2a1908172635445362718293a4b5c6d7e8f90"}${
      "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091"}`,
  );
  assert.notEqual(await other.getAddress(), EXPECTED_ADDRESS);
});

test("derivation is stable across calls, so recovery is repeatable", async () => {
  const [first, second] = await Promise.all([
    accountFor(FIXTURE_PUBLIC_KEY),
    accountFor(FIXTURE_PUBLIC_KEY),
  ]);
  assert.equal(await first.getAddress(), await second.getAddress());
});
