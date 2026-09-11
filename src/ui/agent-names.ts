/**
 * What a person calls each of their agents.
 *
 * A name cannot come from the chain. The grant does carry a label, but the plugin keeps only its
 * hash, so it can be checked and never read back. Every allowance on the phone therefore opened
 * with `0x68c91fb4…787b17e`, and two agents were two identical strings of hex.
 *
 * So the name is the person's own, kept on this phone, keyed by the agent's address. It is a
 * nickname rather than an identity: nothing else trusts it, and losing it loses a word, not money.
 *
 * Pure, so the rules can be tested without a renderer. Storage is `agent-names-context.tsx`.
 */

/** Where the whole record is kept, as one JSON object. One key, so it loads in one read. */
export const AGENT_NAMES_KEY = "arc.agentNames";

/** Long enough for "Research agent (filings)", short enough to sit on one row. */
export const MAX_AGENT_NAME = 32;

/** Lowercased address to name. */
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
  for (const [agent, name] of Object.entries(parsed)) {
    if (typeof name !== "string") continue;
    const clean = cleanAgentName(name);
    if (clean.length > 0) names[agent.toLowerCase()] = clean;
  }
  return names;
}

/** A new record with this agent's name set, or removed when the name is blank. Never mutates. */
export function withAgentName(names: AgentNames, agent: string, name: string): AgentNames {
  const key = agent.toLowerCase();
  const clean = cleanAgentName(name);
  const next: Record<string, string> = { ...names };
  if (clean.length === 0) delete next[key];
  else next[key] = clean;
  return next;
}

/** The name, or `null` for an agent nobody has named. Addresses compare without case. */
export function agentNameOf(names: AgentNames, agent: string): string | null {
  return names[agent.toLowerCase()] ?? null;
}
