import { encodeFunctionData, erc20Abi, type Address, type Hash } from "viem";
import { getUserOperationGasPrice } from "@circle-fin/modular-wallets-core";
import { ARC_CONTRACTS } from "./chain.ts";
import { Usdc } from "./usdc.ts";
import { arcPublicClient } from "./client.ts";
// Type-only: erased at runtime, so this file never loads the passkey shim.
import type { ArcAccount } from "./account.ts";

/**
 * Moving USDC on Arc.
 *
 * Two ways exist, and the choice is not cosmetic:
 *
 *   - **native send** — `value` on the call, 18 decimals. This is the one Arc makes special:
 *     `msg.value` *is* dollars, so a spend policy can bound it directly instead of parsing
 *     ERC-20 calldata. Prefer it.
 *   - **ERC-20 transfer** — via `0x3600…`, 6 decimals. Needed only when the recipient is a
 *     contract expecting an ERC-20 `Transfer`, and it **truncates** sub-cent amounts.
 *
 * Both move the same balance. See `usdc.ts` for why mixing the scales is the trap this
 * codebase is built to make unavailable.
 */

export class ArcSendError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "ArcSendError";
  }
}

export interface SendRequest {
  readonly to: Address;
  readonly amount: Usdc;
}

/**
 * Fees for a user operation, from Circle's bundler rather than from the chain.
 *
 * viem estimates `maxPriorityFeePerGas` from recent blocks, which on Arc produced ~0.48 gwei —
 * below the bundler's own floor, and rejected before submission with
 * `precheck failed: maxPriorityFeePerGas is 480000000 but must be at least 1000000000`.
 * The chain's fee market and the bundler's admission policy are different things, and only the
 * bundler knows the second. `circle_getUserOperationGasPrice` is what it exposes for this.
 *
 * `medium` rather than `low`: all three tiers currently clear the floor comfortably, but the
 * gap between `low` and the floor is the one that closes when the network is busy, and a
 * rejected send costs a user far more than the fee difference — which is sponsored anyway.
 */
async function bundlerFees(account: ArcAccount): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const price = await getUserOperationGasPrice(account.bundler);
  return {
    maxFeePerGas: BigInt(price.medium.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(price.medium.maxPriorityFeePerGas),
  };
}

/** Rejects what Arc rejects, before spending gas to discover it on-chain. */
function assertSendable({ to, amount }: SendRequest): void {
  if (amount.isNegative()) throw new ArcSendError("amount is negative");
  if (amount.isZero()) throw new ArcSendError("amount is zero");
  // Arc reverts value-bearing transfers to the zero address at the protocol level, and a revert
  // that consumes gas is a worse way to learn this than a local check.
  if (/^0x0{40}$/i.test(to)) throw new ArcSendError("Arc forbids value transfers to the zero address");
}

/**
 * Sends USDC natively and returns the **user operation hash** — not a transaction hash.
 * Call `waitForSend` when you need the on-chain hash.
 */
export async function sendUsdc(account: ArcAccount, request: SendRequest): Promise<Hash> {
  assertSendable(request);
  try {
    return await account.bundler.sendUserOperation({
      account: account.smartAccount,
      calls: [{ to: request.to, value: request.amount.toNativeUnits() }],
      ...(await bundlerFees(account)),
    });
  } catch (cause) {
    throw new ArcSendError(`sending ${request.amount} to ${request.to} failed`, { cause });
  }
}

/** Sends through the ERC-20 interface. Only for recipients that require a `Transfer` event. */
export async function sendUsdcAsErc20(account: ArcAccount, request: SendRequest): Promise<Hash> {
  assertSendable(request);
  if (request.amount.hasErc20Dust()) {
    throw new ArcSendError(
      `${request.amount} carries precision the 6-decimal ERC-20 view cannot express; ` +
        "send it natively, or round it first — deliberately, not silently",
    );
  }
  try {
    return await account.bundler.sendUserOperation({
      account: account.smartAccount,
      calls: [{
        to: ARC_CONTRACTS.usdc,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [request.to, request.amount.toErc20Units()],
        }),
      }],
      ...(await bundlerFees(account)),
    });
  } catch (cause) {
    throw new ArcSendError(`ERC-20 transfer of ${request.amount} to ${request.to} failed`, { cause });
  }
}

/**
 * Waits for the user operation to settle and returns the transaction hash.
 *
 * Arc has **sub-second deterministic finality**, so there is no confirmation count to wait for:
 * once this returns, the payment is final. A UI that counts confirmations is wrong here.
 */
export async function waitForSend(account: ArcAccount, userOpHash: Hash): Promise<Hash> {
  const receipt = await account.bundler.waitForUserOperationReceipt({ hash: userOpHash });
  if (!receipt.success) {
    throw new ArcSendError(`user operation ${userOpHash} reverted on-chain`);
  }
  return receipt.receipt.transactionHash;
}

/**
 * The account's balance, read straight from Arc — no bundler, no Circle.
 *
 * Deliberately the **native** balance rather than `balanceOf`: the ERC-20 view truncates below
 * 1e-6 USDC, so it can report zero for an account that holds money.
 */
export async function balanceOf(address: Address): Promise<Usdc> {
  return Usdc.fromNativeUnits(await arcPublicClient.getBalance({ address }));
}
