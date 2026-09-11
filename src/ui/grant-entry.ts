import { isPairingCode } from "../../mcp/pairing.ts";
import type { MandateTerms } from "../arc/mandate.ts";
import type { GrantTerms } from "./grant-terms.ts";
import { readPairingLink, type ScannedAgent } from "./pairing.ts";

/**
 * The grant screen's decisions about who is being granted, kept apart from the screen.
 *
 * The agent can arrive three ways: scanned from its code, pasted as its link, or typed as a bare
 * address. Only the first two carry the one-time pairing code, and the code has to survive from the
 * entry into the grant's tag, or the agent ignores the allowance and the person never learns why.
 * That path is pure, so it is tested here rather than hoped about on a phone.
 */

/** What the agent step holds: the address as entered, and the pairing code when the entry carried one. */
export interface AgentEntry {
  readonly agent: string;
  readonly pairing: string | null;
}

/** From the camera. The scanner has already read the code, so both halves are exactly as scanned. */
export function entryFromScan(scanned: ScannedAgent): AgentEntry {
  return { agent: scanned.address, pairing: scanned.pairing };
}

/**
 * From the keyboard or a paste.
 *
 * The agent's whole link carries its address and its pairing code. Anything else is kept exactly as
 * typed, with no code, so the field shows what the person entered and says what is wrong with it.
 */
export function entryFromText(text: string): AgentEntry {
  const link = readPairingLink(text);
  return link !== null && link.pairing !== null
    ? { agent: link.address, pairing: link.pairing }
    : { agent: text, pairing: null };
}

/** What a grant is labelled when it carries no pairing code, which is what the tag holds instead. */
export const GRANT_LABEL = "agent";

const SECONDS_PER_DAY = 86_400;

/**
 * The terms handed to the grant, from the form's reading and the entry's pairing code.
 *
 * The code goes in unchanged and the label goes in regardless, because the tag is decided by the
 * grant itself: the code when there is one, the label otherwise. A code that is not one is refused
 * here rather than written into a tag the agent will never ask for.
 */
export function mandateTermsFor(terms: GrantTerms, pairing: string | null, nowMs: number): MandateTerms {
  if (pairing !== null && !isPairingCode(pairing)) {
    throw new Error("a pairing code is 32 lowercase hex characters");
  }
  return {
    agent: terms.agent,
    limit: terms.limit,
    payees: [],
    expiresAt: Math.floor(nowMs / 1000) + Math.round(terms.days * SECONDS_PER_DAY),
    label: GRANT_LABEL,
    ...(pairing === null ? {} : { pairing }),
  };
}
