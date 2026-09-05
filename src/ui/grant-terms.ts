import { isAddress, type Address } from "viem";
import { Usdc } from "../arc/usdc.ts";

/**
 * Reading the grant form into terms, or refusing to.
 *
 * One function decides this, because the screen previously decided it **twice**: the button
 * enabled itself on one set of conditions and the grant action re-checked a different set. They
 * disagreed about the expiry, and the way they disagreed was the dangerous direction —
 * an unparseable window became `undefined`, `undefined` means *no expiry*, and the button stayed
 * lit. Clearing the custom days field granted an allowance that never expired.
 *
 * That is the failure mode to design against: invalid input must not resolve to the most
 * permissive reading of it. Here an unreadable window is a refusal, never an unbounded grant.
 *
 * Open-ended allowances are deliberately not expressible from this form. The SDK supports them
 * and `grantSummary` can word them, but expiry is the product's central safety property and
 * removing it should be an explicit choice, not something a blank field can produce.
 */
export interface GrantTerms {
  readonly agent: Address;
  readonly limit: Usdc;
  /** Always a positive, finite number of days. Never absent. */
  readonly days: number;
}

/** What is wrong with each field, or `null` where nothing is. */
export interface GrantProblems {
  readonly agent: string | null;
  readonly amount: string | null;
  readonly days: string | null;
}

/**
 * The longest window the form will express, in days.
 *
 * Two reasons, and the dull one is the sharper. **The contract stores an expiry as `uint48`**, so
 * a large enough day count makes viem refuse to encode the call — an unhandled throw at the
 * moment of granting, from a button that looked ready. And well below that limit the value stops
 * meaning anything: an allowance expiring in the year 275,000 is an allowance with no expiry,
 * which is the exact failure this module exists to prevent, just wearing a number.
 *
 * Ten years is arbitrary but defensible — far past any real agent allowance, far short of the
 * encoding limit. Move it if a use case argues for it; do not remove it.
 */
export const MAX_WINDOW_DAYS = 3650;

export const GRANT_PROBLEMS: GrantProblems = {
  agent: "That is not a valid address. It starts 0x and is 42 characters long.",
  amount: "Enter an amount above zero, like 12.50.",
  days: `Enter a number of days between 1 and ${MAX_WINDOW_DAYS}, or pick a preset.`,
};

export function readGrantTerms({
  agent, amount, days,
}: {
  readonly agent: string;
  readonly amount: string;
  readonly days: string;
}): { readonly terms: GrantTerms } | { readonly problems: GrantProblems } {
  const limit = parseUsdc(amount);
  const window = parseDays(days);
  const problems: GrantProblems = {
    agent: isAddress(agent) ? null : GRANT_PROBLEMS.agent,
    amount: limit === null ? GRANT_PROBLEMS.amount : null,
    days: window === null ? GRANT_PROBLEMS.days : null,
  };

  if (!isAddress(agent) || limit === null || window === null) return { problems };
  return { terms: { agent, limit, days: window } };
}

/**
 * `null` rather than a throw: an incomplete value is the normal state of a field being typed into.
 *
 * The positivity check is not belt-and-braces. `Usdc.parse` accepts "-1" and returns a negative
 * quantity, which is meaningless as a spend limit and only fails much later, when viem refuses to
 * encode a negative number as a `uint256` — by which point the button has been enabled and the
 * person has tapped it. Zero is refused for a duller reason: it grants nothing and still costs a
 * transaction to grant.
 */
function parseUsdc(text: string): Usdc | null {
  try {
    const amount = Usdc.parse(text);
    return amount.toNativeUnits() > 0n ? amount : null;
  } catch {
    return null;
  }
}

function parseDays(text: string): number | null {
  // `Number("")` is 0 and `Number(" ")` is 0, so an empty field must not reach a truthiness test.
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value <= MAX_WINDOW_DAYS ? value : null;
}
