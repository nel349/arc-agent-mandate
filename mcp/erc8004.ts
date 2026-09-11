import {
  encodeFunctionData, parseAbi, parseEventLogs, zeroAddress,
  type Address, type Log, type PublicClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Call } from "./gateway.ts";

/**
 * The agent's ERC-8004 identity: registered by the wallet that granted the allowance, and linked to
 * the agent's own key.
 *
 * A seller that rewards agents, the maze among them, writes its reward against an identity and pays
 * its badge to whoever owns that identity. So the identity has to be the owner's, and the agent's key
 * has to be its agent wallet, or the seller cannot tell that the agent paying is the one it credits.
 * Nothing did this before 09-11: the one identity that worked was made by hand, and every other agent
 * solved the maze and earned nothing.
 *
 * It is done through the allowance, from the owner's account, because that is who has to own it:
 * `register()` mints to its caller. The allowance names exactly these two calls for it
 * (`IDENTITY_CALLS` in `src/arc/mandate.ts`), and neither moves money. It takes two operations rather
 * than one because the agent's signature commits to the identity's number, and the registry only
 * assigns that number inside `register()`.
 */

/** Arc's ERC-8004 identity registry. The app names the same address in `src/arc/chain.ts`. */
export const IDENTITY_REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

/**
 * How long the agent's link signature stays good. The registry refuses one that is valid for more
 * than five minutes, and four leaves the operation room to land.
 */
export const LINK_WINDOW_SECONDS = 240n;

const registryAbi = parseAbi([
  "function register() returns (uint256)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

/** What the agent signs to consent to being an identity's agent wallet, as the registry checks it. */
const AGENT_WALLET_SET = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const REGISTRY_DOMAIN = { name: "ERC8004IdentityRegistry", version: "1" } as const;

const same = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase();

/** Registers a new identity, owned by whoever makes the call: the account. */
export function registerCall(): Call {
  return {
    to: IDENTITY_REGISTRY,
    value: 0n,
    data: encodeFunctionData({ abi: registryAbi, functionName: "register" }),
  };
}

/**
 * The identity a registration minted to `owner`, read from the operation's own logs.
 *
 * A bundle can carry other people's operations, so only a mint by this registry to this owner
 * counts, and anything other than exactly one is not guessed at.
 */
export function registeredIdentity(logs: readonly Log[], owner: Address): bigint | null {
  const minted = parseEventLogs({ abi: registryAbi, eventName: "Transfer", logs: [...logs] })
    .filter((log) =>
      same(log.address, IDENTITY_REGISTRY) && same(log.args.from, zeroAddress) && same(log.args.to, owner));
  return minted.length === 1 && minted[0] !== undefined ? minted[0].args.tokenId : null;
}

/** When and where the agent's link signature is good. */
export interface Link {
  readonly agentId: bigint;
  /** The identity's owner, which the signature names so it cannot be replayed onto another. */
  readonly owner: Address;
  /** Unix seconds, at most five minutes from now by the chain's clock. */
  readonly deadline: bigint;
  readonly chainId: number;
}

/** Links the agent's key to the identity, carrying the agent's own signature of consent. */
export async function linkCall(agent: PrivateKeyAccount, link: Link): Promise<Call> {
  const signature = await agent.signTypedData({
    domain: { ...REGISTRY_DOMAIN, chainId: link.chainId, verifyingContract: IDENTITY_REGISTRY },
    types: AGENT_WALLET_SET,
    primaryType: "AgentWalletSet",
    message: { agentId: link.agentId, newWallet: agent.address, owner: link.owner, deadline: link.deadline },
  });
  return {
    to: IDENTITY_REGISTRY,
    value: 0n,
    data: encodeFunctionData({
      abi: registryAbi, functionName: "setAgentWallet",
      args: [link.agentId, agent.address, link.deadline, signature],
    }),
  };
}

/**
 * Where an identity stands for this agent and this wallet.
 *
 * `linked` is ready to be declared. `unlinked` is the wallet's but does not name this agent, which is
 * what a link that never landed leaves. `gone` has left the wallet, and a transfer also clears the
 * agent wallet, so it cannot be declared by this agent for this owner again.
 */
export type IdentityState = "linked" | "unlinked" | "gone";

export async function identityState(
  client: PublicClient, agentId: bigint, owner: Address, agent: Address,
): Promise<IdentityState> {
  const [holder, wallet] = await Promise.all([
    client.readContract({ address: IDENTITY_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [agentId] }),
    client.readContract({ address: IDENTITY_REGISTRY, abi: registryAbi, functionName: "getAgentWallet", args: [agentId] }),
  ]);
  if (!same(holder, owner)) return "gone";
  return same(wallet, agent) ? "linked" : "unlinked";
}

/** Calls sent from the owner's account under the allowance, and what they logged, or why not. */
export type Submit = (calls: readonly Call[]) => Promise<
  | { readonly ok: true; readonly logs: readonly Log[] }
  | { readonly ok: false; readonly reason: string }
>;

export interface IdentitySetUp {
  readonly agent: PrivateKeyAccount;
  /** The wallet that granted the allowance, which will own the identity. */
  readonly owner: Address;
  /** The identity already set up for this wallet, if one is remembered. */
  readonly remembered: bigint | null;
  readonly client: PublicClient;
  readonly submit: Submit;
  /**
   * Called the moment an identity is registered, before it is linked, so a link that fails is tried
   * again for the same identity rather than leading to a second one.
   */
  readonly remember: (agentId: bigint) => void;
}

export type IdentityOutcome =
  | { readonly ok: true; readonly agentId: bigint; readonly registered: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Makes sure this agent has an identity the wallet owns and that names the agent, doing only what is
 * missing: nothing when one is linked, the link when one is registered and unlinked, and both when
 * there is none or the one remembered has left the wallet.
 */
export async function setUpIdentity(
  { agent, owner, remembered, client, submit, remember }: IdentitySetUp,
): Promise<IdentityOutcome> {
  let agentId = remembered;
  if (agentId !== null) {
    const state = await identityState(client, agentId, owner, agent.address);
    if (state === "linked") return { ok: true, agentId, registered: false };
    if (state === "gone") agentId = null;
  }

  let registered = false;
  if (agentId === null) {
    const registration = await submit([registerCall()]);
    if (!registration.ok) return { ok: false, reason: registration.reason };
    agentId = registeredIdentity(registration.logs, owner);
    if (agentId === null) {
      return { ok: false, reason: "the registration landed, but minted no identity to this wallet" };
    }
    remember(agentId);
    registered = true;
  }

  // The chain's clock rather than this machine's, since the registry compares against block time.
  const [{ timestamp }, chainId] = await Promise.all([client.getBlock(), client.getChainId()]);
  const link = await linkCall(agent, { agentId, owner, deadline: timestamp + LINK_WINDOW_SECONDS, chainId });
  const linked = await submit([link]);
  if (!linked.ok) return { ok: false, reason: linked.reason };
  return { ok: true, agentId, registered };
}
