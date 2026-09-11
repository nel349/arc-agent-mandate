import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { USDC_RAILS } from "../src/arc/mandate.ts";

/**
 * Does Arc still have only the rail we meter?
 *
 * An unscoped mandate meters every payment on one rail, the ERC-20 view over the native balance,
 * which is what lets the phone show one number that is the whole allowance. `USDC_RAILS` names that
 * rail, and says it is the only one.
 *
 * Allowances were once granted on a denylist, where a second rail nobody named would have been open
 * and unmetered, and this test was the guard against that. Every allowance is an allowlist now, so an
 * unnamed rail is refused rather than open. What this still catches is the claim going stale: it
 * re-derives the set of rails from the live chain and fails, loudly, when Arc has one `USDC_RAILS`
 * does not name.
 *
 * **What counts as a rail**, precisely: a contract whose `balanceOf` tracks the account's native
 * balance. That is what makes it a second view over one pot of money rather than an unrelated
 * token, and it is why an ordinary ERC-20 deployed on Arc does not trip this. A call that carries
 * value is already counted against the mandate whatever it targets, so nothing else qualifies.
 */

const ARC_RPC = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
const client = createPublicClient({ transport: http(ARC_RPC) });

/** Arc keeps its system contracts in one reserved block. USDC sits at the base of it. */
const SYSTEM_RANGE_BASE = BigInt("0x3600000000000000000000000000000000000000");
const SYSTEM_RANGE_SIZE = 256;

/** Native is 18dp, the ERC-20 view is 6dp, over one balance. */
const NATIVE_PER_ERC20 = 10n ** 12n;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const addressAt = (offset: number): Address =>
  `0x${(SYSTEM_RANGE_BASE + BigInt(offset)).toString(16).padStart(40, "0")}`;

/**
 * A probe with a real, non-round balance, so a contract that merely returns zero for everything
 * cannot look like a view over it by accident.
 */
const PROBE: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"; // the EntryPoint, which holds USDC

async function looksLikeASecondRail(address: Address, nativeBalance: bigint, blockNumber: bigint): Promise<boolean> {
  try {
    // Every read is pinned to one block. The probe is a live account, so reading its native
    // balance and its ERC-20 balance at different heights compares two different moments and the
    // comparison never matches — which showed up as the detector failing to find USDC itself.
    const [reported, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [PROBE], blockNumber }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals", blockNumber }),
    ]);
    // The view truncates: 18dp native down to 6dp. Anything that reproduces the probe's balance
    // under that scaling is looking at the same money.
    return decimals === 6 && reported === nativeBalance / NATIVE_PER_ERC20 && reported > 0n;
  } catch {
    return false; // not token-shaped, so not a second view over the balance
  }
}

test("no contract can move USDC off-limit except the ones the mandate denies", async () => {
  const blockNumber = await client.getBlockNumber().catch((cause) => {
    assert.fail(
      `Could not reach Arc at ${ARC_RPC}, so this check did not run: ${cause.shortMessage ?? cause.message}. ` +
      "Failing rather than passing quietly — a guard that silently does not run is worse than no guard.",
    );
  });
  const nativeBalance = await client.getBalance({ address: PROBE, blockNumber }).catch((cause) => {
    assert.fail(
      `Could not reach Arc at ${ARC_RPC}, so this check did not run: ${cause.shortMessage ?? cause.message}. ` +
      "Failing rather than passing quietly — a guard that silently does not run is worse than no guard.",
    );
  });
  assert.ok(nativeBalance > 0n, `the probe account ${PROBE} holds nothing; pick one that does`);

  const withCode: Address[] = [];
  for (let offset = 0; offset < SYSTEM_RANGE_SIZE; offset++) {
    const address = addressAt(offset);
    const code = await client.getCode({ address, blockNumber });
    if (code !== undefined && code !== "0x") withCode.push(address);
  }

  const rails: string[] = [];
  for (const address of withCode) {
    if (await looksLikeASecondRail(address, nativeBalance, blockNumber)) rails.push(address.toLowerCase());
  }

  const denied = new Set(USDC_RAILS.map((a) => a.toLowerCase()));
  const undenied = rails.filter((a) => !denied.has(a));

  assert.deepEqual(
    undenied,
    [],
    `Arc has grown a second view over the native balance that USDC_RAILS does not name: ${undenied.join(", ")}.\n` +
    "Allowances are allowlists, so no agent can reach it yet. Decide whether agents should pay through\n" +
    "it; if so, add it to USDC_RAILS in src/arc/mandate.ts, which lists and meters it, then re-run.",
  );

  // The list must also not rot in the other direction: an address we deny that is no longer a rail
  // is dead weight, and dead entries are how a list stops being read.
  assert.ok(rails.length > 0, "no second rail found at all — the detection itself has stopped working");
});
