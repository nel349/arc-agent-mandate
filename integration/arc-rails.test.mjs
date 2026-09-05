import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http, parseAbi } from "viem";
import { DENIED_RAILS } from "../src/arc/mandate.ts";

/**
 * Does Arc still have only the rails we deny?
 *
 * An unscoped mandate is granted on a **denylist**: the agent may pay anyone except the addresses
 * we name. That is the only setting that expresses what the product promises — bounded by how much
 * and how long, not by who — but it carries one weakness. A denylist is only as complete as the
 * list, so a contract that can move USDC without carrying `msg.value` and is *not* on it would let
 * an agent spend past its limit, because the native counter would never see the money leave.
 *
 * The weakness is not that such a contract might appear. It is that it would appear **silently**.
 * This test is what makes it loud: it re-derives the set of second rails from the live chain and
 * fails when it finds one `DENIED_RAILS` does not name.
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

const addressAt = (offset) =>
  "0x" + (SYSTEM_RANGE_BASE + BigInt(offset)).toString(16).padStart(40, "0");

/**
 * A probe with a real, non-round balance, so a contract that merely returns zero for everything
 * cannot look like a view over it by accident.
 */
const PROBE = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"; // the EntryPoint, which holds USDC

async function looksLikeASecondRail(address, nativeBalance, blockNumber) {
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

  const withCode = [];
  for (let offset = 0; offset < SYSTEM_RANGE_SIZE; offset++) {
    const address = addressAt(offset);
    const code = await client.getCode({ address, blockNumber });
    if (code !== undefined && code !== "0x") withCode.push(address);
  }

  const rails = [];
  for (const address of withCode) {
    if (await looksLikeASecondRail(address, nativeBalance, blockNumber)) rails.push(address.toLowerCase());
  }

  const denied = new Set(DENIED_RAILS.map((a) => a.toLowerCase()));
  const undenied = rails.filter((a) => !denied.has(a));

  assert.deepEqual(
    undenied,
    [],
    `Arc has grown a second view over the native balance that no mandate denies: ${undenied.join(", ")}.\n` +
    "Until it is added to DENIED_RAILS in src/arc/mandate.ts, an agent on an unscoped mandate can\n" +
    "move USDC through it without the spend limit ever counting it. Add it, then re-run.",
  );

  // The list must also not rot in the other direction: an address we deny that is no longer a rail
  // is dead weight, and dead entries are how a list stops being read.
  assert.ok(rails.length > 0, "no second rail found at all — the detection itself has stopped working");
});
