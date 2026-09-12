import type { Activity } from "../arc/activity.ts";

/**
 * What a person calls each of their allowances.
 *
 * A name cannot come from the chain. The grant does carry a label, but the plugin keeps only its
 * hash, so it can be checked and never read back. Every allowance on the phone therefore opened
 * with `0x68c91fb4…787b17e`, and two agents were two identical strings of hex.
 *
 * So the name is the person's own, kept on this phone. It belongs to one allowance, keyed by the
 * grant's own log (`allowanceKey`). It used to be keyed by the agent's address, which is what renamed
 * every earlier allowance in the feed whenever the same agent was granted again. Names kept by address
 * before that still read, for the agent's current allowance only. A name is a nickname rather than an
 * identity: nothing else trusts it, and losing it loses a word, not money.
 *
 * Pure, so the rules can be tested without a renderer. Storage is `agent-names-context.tsx`.
 */

/** Where the whole record is kept, as one JSON object. One key, so it loads in one read. */
export const AGENT_NAMES_KEY = "arc.agentNames";

/** Long enough for "Research agent (filings)", short enough to sit on one row. */
export const MAX_AGENT_NAME = 32;

/** An allowance's key, or a lowercased address kept from before names belonged to allowances, to name. */
export type AgentNames = Readonly<Record<string, string>>;

export const NO_NAMES: AgentNames = Object.freeze({});

/** A name as it will be kept: trimmed, inner runs of whitespace collapsed, capped. Empty is unnamed. */
export function cleanAgentName(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, MAX_AGENT_NAME);
}

/**
 * The stored record, or nothing.
 *
 * Tolerant on purpose. The record is written only by this app, but a half-written value or one
 * from an older shape must cost the names, never the screen.
 */
export function parseAgentNames(stored: string | null): AgentNames {
  if (stored === null) return NO_NAMES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return NO_NAMES;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return NO_NAMES;

  const names: Record<string, string> = {};
  for (const [key, name] of Object.entries(parsed)) {
    if (typeof name !== "string") continue;
    const clean = cleanAgentName(name);
    if (clean.length > 0) names[key.toLowerCase()] = clean;
  }
  return names;
}

/** A new record with this key's name set, or removed when the name is blank. Never mutates. */
export function withAgentName(names: AgentNames, key: string, name: string): AgentNames {
  const at = key.toLowerCase();
  const clean = cleanAgentName(name);
  const next: Record<string, string> = { ...names };
  if (clean.length === 0) delete next[at];
  else next[at] = clean;
  return next;
}

/** The name kept under a key, or `null`. Keys compare without case. */
export function agentNameOf(names: AgentNames, key: string): string | null {
  return names[key.toLowerCase()] ?? null;
}

// ---- one name per allowance ------------------------------------------------

/**
 * Which allowance a name belongs to: the grant's own log, as `tx:logIndex`.
 *
 * Unique to the grant, and what the feed already reads, so each allowance keeps its own name even
 * when one agent is granted several times over.
 */
export const allowanceKey = (tx: string, logIndex: number): string => `${tx.toLowerCase()}:${logIndex}`;

/** Where something sits on the chain: its block, then its place in the block. */
export interface ChainPosition {
  readonly block: bigint;
  readonly logIndex: number;
}

/** A grant as the names need it: whose it is, where it sits, and its key. */
export interface Grant extends ChainPosition {
  /** Lowercased. */
  readonly agent: string;
  readonly key: string;
}

/** A log reference for a grant that has just landed, as the grant's receipt gives it. */
export interface GrantLog {
  readonly tx: string;
  readonly logIndex: number;
}

const notAfter = (a: ChainPosition, b: ChainPosition): boolean =>
  a.block < b.block || (a.block === b.block && a.logIndex <= b.logIndex);

/** Every grant the feed has read, as the names need them. */
export function grantsIn(items: readonly Activity[]): Grant[] {
  return items
    .filter((item) => item.kind === "granted")
    .map((item) => ({
      agent: item.agent.toLowerCase(), block: item.block, logIndex: item.logIndex, key: allowanceKey(item.tx, item.logIndex),
    }));
}

/**
 * The agent's latest grant at or before a point on the chain, or at all when `at` is null.
 *
 * For a row, that is the allowance it happened under. For the agent, that is its current allowance.
 * Null when no such grant has been read, which for an old row means its grant is older than the feed.
 */
export function grantAt(agent: string, at: ChainPosition | null, grants: readonly Grant[]): Grant | null {
  const who = agent.toLowerCase();
  let found: Grant | null = null;
  for (const grant of grants) {
    if (grant.agent !== who || (at !== null && !notAfter(grant, at))) continue;
    if (found === null || notAfter(found, grant)) found = grant;
  }
  return found;
}

/**
 * The name one allowance shows, given the grant it is and the agent's latest grant.
 *
 * Its own name when it was given one. A name kept by address, from before names belonged to
 * allowances, belongs to the agent's current allowance only, so an older allowance shows its address
 * rather than borrowing a name given to a later grant.
 */
export function allowanceName(
  names: AgentNames, agent: string, grant: Grant | null, latest: Grant | null,
): string | null {
  if (grant !== null) {
    const own = names[grant.key];
    if (own !== undefined) return own;
  }
  const current = latest === null || (grant !== null && grant.key === latest.key);
  return current ? names[agent.toLowerCase()] ?? null : null;
}

/**
 * The record once a new allowance has landed for an agent.
 *
 * The name given in the grant flow goes to the new allowance alone. A name kept by address belonged to
 * the allowance before it, so it moves to that grant's key when that is known, and stops being the
 * agent's; otherwise it would now read as the new allowance's name. Without the new grant's log, the
 * name is kept by address, which the rule above gives to the current allowance.
 */
export function withNewAllowance(
  names: AgentNames, agent: string, granted: GrantLog | null, previous: Grant | null, name: string,
): AgentNames {
  const address = agent.toLowerCase();
  const next: Record<string, string> = { ...names };
  const legacy = next[address];
  if (legacy !== undefined) {
    if (previous !== null && next[previous.key] === undefined) next[previous.key] = legacy;
    delete next[address];
  }
  const clean = cleanAgentName(name);
  if (clean.length > 0) next[granted === null ? address : allowanceKey(granted.tx, granted.logIndex)] = clean;
  return next;
}
