import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";

/**
 * Tying a grant to the code it was made from.
 *
 * Anyone can grant an allowance to an agent's address: granting needs nothing but the address, and
 * the address is public. So "the first grant naming this agent" is not the same as "the owner's
 * grant". A stranger's could be the one found, and an owner who granted again from a second wallet
 * was ignored in favour of the first.
 *
 * So the agent's code carries a one-time pairing code as well as its address. The phone writes a
 * hash of it into the grant's `tag`, which the session-key plugin records in `SessionKeyAdded` and
 * uses for nothing else, and which the event indexes, so the agent can ask the chain for exactly the
 * grants carrying its code. A grant made any other way carries no code the agent is waiting for, and
 * is not used.
 *
 * The phone app imports this file as well as the connector, so it holds nothing Node-only: both
 * sides must compute the same tag from the same code, and one definition is how they cannot drift.
 */

/** Written in front of the code before hashing, so a pairing tag cannot collide with a label tag. */
export const PAIRING_TAG_PREFIX = "arc-mandate pairing v1:";

/** Sixteen random bytes, as lowercase hex. */
const PAIRING_CODE = /^[0-9a-f]{32}$/;

export const isPairingCode = (value: string): boolean => PAIRING_CODE.test(value);

/** The tag a grant carrying this code writes into `SessionKeyAdded`. */
export function pairingTag(code: string): Hex {
  if (!isPairingCode(code)) throw new Error("a pairing code is 32 lowercase hex characters");
  return keccak256(toHex(`${PAIRING_TAG_PREFIX}${code}`));
}

/** What the agent's QR encodes: an EIP-681 link to its address on Arc, carrying the code. */
export function pairingLink(address: Address, chainId: number, code: string): string {
  return `ethereum:${address}@${chainId}?pairing=${code}`;
}

/** What a scanned or pasted code says: the agent's address, and its pairing code when it has one. */
export interface ScannedAgent {
  readonly address: Address;
  readonly pairing: string | null;
}

/**
 * Read a scanned or pasted code.
 *
 * Accepts the link the connector prints, an `ethereum:` link with no code (what a wallet elsewhere
 * produces), and a bare address. A link whose pairing code is malformed is refused whole rather than
 * read as having none: that would grant an allowance the agent then ignores, with nothing saying why.
 *
 * Read by hand rather than with `URLSearchParams`, which React Native only partly implements.
 */
export function readPairingLink(scanned: string): ScannedAgent | null {
  const text = scanned.trim();
  // ethereum:0xabc… , optionally with @chainId, then ?params or a /function, per EIP-681.
  const uri = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@\d+)?(?:([?/])(.*))?$/.exec(text);
  const candidate = uri?.[1] ?? text;
  if (!isAddress(candidate)) return null;

  const query = uri?.[2] === "?" ? (uri[3] ?? "") : "";
  const param = query.split("&").find((part) => part.startsWith("pairing="));
  if (param === undefined) return { address: candidate, pairing: null };
  const code = param.slice("pairing=".length).toLowerCase();
  return isPairingCode(code) ? { address: candidate, pairing: code } : null;
}
