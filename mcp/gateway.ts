import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { publicClient, USDC_ERC20_VIEW, type EscrowTally } from "./chain.ts";

/** One call in a batch, as `executeWithSessionKey` takes it. */
export interface Call {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
}

/**
 * The agent's escrow, and the calls that fill it.
 *
 * **Why an agent needs an escrow at all.** Circle's Gateway verifies an x402 payment by recovering
 * the signer and comparing it to the payer's own address. A smart-contract wallet cannot satisfy
 * that however it signs — measured against the live testnet API, including with a contract that
 * returns the ERC-1271 magic value for every signature, and including with an on-chain authorised
 * delegate. Strict `ecrecover`, no exceptions.
 *
 * So the agent pays as itself, and the account funds it. `depositFor` credits the *agent's*
 * Gateway balance while the account provides the money, which is the shape that makes this
 * tolerable: the agent's own wallet stays empty, the escrow can only leave as a payment or a
 * delayed withdrawal, and the agent needs no gas at any point — the funding is a sponsored
 * operation from the account, and the payment itself is a signature rather than a transaction.
 *
 * **What it costs, stated rather than buried.** Escrow is not clawback-able: `withdraw` pays
 * `msg.sender` and only the depositor may call it, so money committed here is the agent's to
 * withdraw. And the plugin meters how much is approved without looking at who is approved, so a
 * compromised agent could approve someone other than the Gateway. Both exposures are bounded by the
 * allowance itself, and by how little of it has been moved here — which is why this tops up per
 * purchase rather than once and large.
 */

/**
 * What is *really* spendable from escrow, which is less than the chain says.
 *
 * A payment reaches Circle as a signature, is accepted into a batch, and lands on chain about a
 * quarter of an hour later. Between those two moments the money is committed but the on-chain
 * balance still counts it, so `availableBalance` overstates what the facilitator will accept — and
 * a top-up that trusts the chain decides it has enough, declines to add anything, and the purchase
 * is refused anyway. Measured: a $0.002 look refused against $0.008 of on-chain escrow.
 *
 * We are the only spender of this escrow, so we can simply remember what we claimed. When the
 * chain figure drops, that much has settled and is no longer outstanding, which keeps the estimate
 * from drifting upward forever.
 *
 * Deliberately an estimate that errs toward topping up: paying twice costs a fraction of a cent,
 * and a refusal in the middle of a run costs the run.
 *
 * Remembered beside the agent's key through `remember`, because the connector restarts whenever its
 * MCP client reconnects, and a tally held only in memory forgot every payment still settling.
 */
export interface EscrowLedger {
  /** The chain's figure, less what we have claimed against it and not yet seen settle. */
  spendable(onChain: bigint): bigint;
  /** Called when a payment has been accepted, whether or not it has settled. */
  claimed(amount: bigint): void;
}

export function escrowLedger(
  /** Where the last run of the connector left off. */
  start: EscrowTally = { outstanding: 0n, lastSeen: null },
  /** Handed the tally every time it changes, so it outlives the process. */
  remember: (tally: EscrowTally) => void = () => {},
): EscrowLedger {
  let outstanding = start.outstanding;
  let lastSeen = start.lastSeen;

  return {
    spendable(onChain) {
      const before = { outstanding, lastSeen };
      if (lastSeen !== null && onChain < lastSeen) {
        const settled = lastSeen - onChain;
        outstanding = outstanding > settled ? outstanding - settled : 0n;
      }
      lastSeen = onChain;
      if (outstanding !== before.outstanding || lastSeen !== before.lastSeen) remember({ outstanding, lastSeen });
      return onChain > outstanding ? onChain - outstanding : 0n;
    },
    claimed(amount) {
      outstanding += amount;
      remember({ outstanding, lastSeen });
    },
  };
}

/** Circle's Gateway Wallet. Same address on every chain Gateway supports. */
export const GATEWAY_WALLET: Address = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

// Re-exported so a caller working with escrow does not have to know it lives in `chain.ts`.
// Not redefined: the address is one fact, and a second copy is a second thing to get wrong.
export { USDC_ERC20_VIEW };

const gatewayAbi = parseAbi([
  "function depositFor(address token, address depositor, uint256 value)",
  "function availableBalance(address token, address depositor) view returns (uint256)",
  "function isTokenSupported(address token) view returns (bool)",
  "function paused() view returns (bool)",
]);

const erc20Abi = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);

/** What the agent can spend online right now, at ERC-20 scale. */
export async function readEscrow(agentAddress: Address): Promise<bigint> {
  return publicClient.readContract({
    address: GATEWAY_WALLET,
    abi: gatewayAbi,
    functionName: "availableBalance",
    args: [USDC_ERC20_VIEW, agentAddress],
  });
}

/**
 * The two calls that move money from the account into the agent's escrow.
 *
 * Batched deliberately: an approval that lands without its deposit is a standing authority over
 * the account's USDC, which is the thing this design exists to avoid. `executeWithSessionKey`
 * takes them as one operation, so either both happen or neither does.
 *
 * Approved for exactly what is deposited, for the same reason. The Gateway consumes the whole
 * allowance in `depositFor`, so nothing is left behind — and the plugin counts an approved amount
 * every time it sees one, whether or not an allowance already exists, so a larger approval would
 * spend the allowance without buying anything.
 */
export function topUpCalls(agentAddress: Address, amountErc20: bigint): readonly Call[] {
  if (amountErc20 <= 0n) throw new Error("A top-up must be positive.");
  return [
    {
      to: USDC_ERC20_VIEW,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [GATEWAY_WALLET, amountErc20],
      }),
    },
    {
      to: GATEWAY_WALLET,
      value: 0n,
      data: encodeFunctionData({
        abi: gatewayAbi,
        functionName: "depositFor",
        args: [USDC_ERC20_VIEW, agentAddress, amountErc20],
      }),
    },
  ];
}

/**
 * Whether Gateway can take a deposit at all, checked before spending an operation on finding out.
 *
 * Both of these are things Circle can change without telling us, and both fail in ways that look
 * like our bug rather than theirs.
 */
export async function gatewayAccepting(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [supported, paused] = await Promise.all([
    publicClient.readContract({
      address: GATEWAY_WALLET, abi: gatewayAbi, functionName: "isTokenSupported", args: [USDC_ERC20_VIEW],
    }),
    publicClient.readContract({ address: GATEWAY_WALLET, abi: gatewayAbi, functionName: "paused" }),
  ]);
  if (paused) return { ok: false, reason: "Circle's Gateway is paused on this network." };
  if (!supported) return { ok: false, reason: "Gateway does not support USDC on this network." };
  return { ok: true };
}
