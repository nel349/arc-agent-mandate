import { encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { entryPoint07Abi, entryPoint07Address, getUserOperationHash, toSmartAccount, type SmartAccount, type SmartAccountImplementation } from "viem/account-abstraction";

/**
 * The granting account, as viem sees it, signed for by the agent's session key.
 *
 * Assembling a user operation by hand is a bad trade, and this module exists because that was
 * tried first. The operation reached Circle's bundler, was accepted into its mempool, and was
 * then never included — well formed, correctly nonced, adequately priced, and silently unusable.
 * Somewhere in the packing of gas limits, paymaster fields and the hash they are signed over,
 * something disagreed with what the bundler computed, and none of it announced itself.
 *
 * viem already does that assembly, and the phone proves it works against this exact bundler and
 * paymaster. So the operation is built by viem and only the **signature** is ours: the session key
 * signs the EntryPoint's own hash with a plain ECDSA signature, which is what the plugin recovers.
 *
 * The two things that differ from an ordinary smart account:
 *
 * - **The nonce key is the session key's address.** The plugin requires it, so an agent's
 *   operations stay sequential and one bundle cannot invalidate its own later entries. viem
 *   defaults the key to zero, which the plugin refuses.
 * - **Calls are wrapped in `executeWithSessionKey`**, not `execute`. That is the plugin's entry
 *   point, and the only path a session key is allowed to take.
 */

export const sessionKeyExecutionAbi = parseAbi([
  "function executeWithSessionKey((address target,uint256 value,bytes data)[] calls, address sessionKey) returns (bytes[])",
]);

/** Long enough to price validation; replaced by the real signature before sending. */
export const STUB_SIGNATURE: Hex = `0x${"ff".repeat(64)}1b`;

/**
 * The shape viem hands to `signUserOperation`, taken from viem rather than written out here.
 *
 * Writing it by hand meant guessing at `UnionPartialBy<UserOperation, "sender">` and getting it
 * subtly wrong; derived, it follows whatever viem changes it to and the compiler says so.
 */
type SignUserOperation = NonNullable<Parameters<typeof toSmartAccount>[0]["signUserOperation"]>;
type UserOperationToSign = Parameters<SignUserOperation>[0];

export interface SessionKeyAccountOptions {
  /** The granting account — the smart wallet, not the agent. */
  readonly address: Address;
  /** The agent's own key, which signs but owns nothing. */
  readonly agent: PrivateKeyAccount;
  /** A client for the network the account is on, which the operation's hash is bound to. */
  readonly client: PublicClient;
}

/** The nonce key an agent's operations go under: its own address, as the plugin requires. */
export const nonceKeyOf = (agent: Address): bigint => BigInt(agent);

/** The account viem builds, as a type of its own: written out, so a published declaration says exactly this. */
export type SessionKeyAccount = SmartAccount<SmartAccountImplementation<typeof entryPoint07Abi, "0.7">>;

export async function toSessionKeyAccount({ address, agent, client: publicClient }: SessionKeyAccountOptions): Promise<SessionKeyAccount> {

  return toSmartAccount({
    client: publicClient,
    entryPoint: { abi: entryPoint07Abi, address: entryPoint07Address, version: "0.7" },

    async getAddress() {
      return address;
    },

    async encodeCalls(calls: readonly { to: Address; value?: bigint | undefined; data?: Hex | undefined }[]): Promise<Hex> {
      return encodeFunctionData({
        abi: sessionKeyExecutionAbi,
        functionName: "executeWithSessionKey",
        args: [
          calls.map((call) => ({ target: call.to, value: call.value ?? 0n, data: call.data ?? "0x" })),
          agent.address,
        ],
      });
    },

    /** Always deployed: an agent is granted an allowance by an account that already exists. */
    async getFactoryArgs() {
      return { factory: undefined, factoryData: undefined };
    },

    /**
     * The session key owns its nonce key, which the plugin checks. viem would otherwise ask for
     * key zero and the operation would be refused during validation.
     */
    async getNonce() {
      return publicClient.readContract({
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        functionName: "getNonce",
        args: [address, nonceKeyOf(agent.address)],
      });
    },

    async getStubSignature(): Promise<Hex> {
      return STUB_SIGNATURE;
    },

    async signUserOperation(parameters: UserOperationToSign): Promise<Hex> {
      const { chainId = await publicClient.getChainId(), ...userOperation } = parameters;
      const hash = getUserOperationHash({
        chainId,
        entryPointAddress: entryPoint07Address,
        entryPointVersion: "0.7",
        userOperation: { ...userOperation, sender: address },
      });
      // A plain ECDSA signature over the EntryPoint's hash. The plugin recovers the signer and
      // checks it is a session key of this account, so no account-specific wrapping applies.
      return agent.signMessage({ message: { raw: hash } });
    },

    async signMessage() {
      throw new Error("a session key signs operations, not messages");
    },
    async signTypedData() {
      throw new Error("a session key signs operations, not typed data");
    },
  });
}

