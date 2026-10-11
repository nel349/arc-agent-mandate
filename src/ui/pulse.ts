import type { Activity } from "../arc/activity.ts";
import type { Mandate } from "../arc/mandate.ts";
import { lastSpentAt } from "./activity-format.ts";
import { hasEnded } from "./mandate-format.ts";

/**
 * How an agent is, which is the one thing the heartbeat line says.
 *
 * No React in it. The rule for when an agent counts as spending is worth more than the line that
 * draws it, and it is the kind of rule that is wrong at its edges, so it lives where a test reaches.
 */
export type Pulse = "spending" | "resting" | "stopped";

/**
 * How long after a payment an agent still reads as spending.
 *
 * A minute and a half. An agent at work pays every few seconds to every few tens of seconds, and
 * the wallet learns of a payment up to about fifteen seconds after it happens, so anything much
 * shorter flickers between spending and resting in the middle of a run. Anything much longer says
 * "now" about something that is over.
 */
export const SPENDING_FOR_S = 90;

/** Why an agent that is stopped is stopped, for the words beside the line. */
export type Stopped = "ended" | "spent out";

/** What an allowance can still do: nothing, if its window has closed or nothing is left of it. */
export function stoppedBy(mandate: Mandate, now: number = Date.now()): Stopped | null {
  if (hasEnded(mandate, now)) return "ended";
  if (mandate.remaining.isZero()) return "spent out";
  return null;
}

/**
 * `lastSpent` is when money last moved for this agent, in seconds, or `null` when the wallet has
 * seen none. A time in the future is a clock that disagrees with the chain's, and reads as now.
 */
export function pulseOf(mandate: Mandate, lastSpent: number | null, now: number = Date.now()): Pulse {
  if (stoppedBy(mandate, now) !== null) return "stopped";
  if (lastSpent === null) return "resting";
  return Math.floor(now / 1000) - lastSpent <= SPENDING_FOR_S ? "spending" : "resting";
}

/**
 * When this agent last spent: the chain's own time for it where the chain keeps one, and otherwise
 * its newest payment among `payments`. The one-meter rail the app grants never sets the chain's.
 *
 * `payments` are this allowance's rows. An agent whose allowance was revoked and granted again has
 * older rows in the feed, and a new allowance that has spent nothing is not spending because an old
 * one did.
 */
export function lastSpentBy(mandate: Mandate, payments: readonly Activity[]): number | null {
  if (mandate.lastUsedAt !== null) return mandate.lastUsedAt;
  const agent = mandate.agent.toLowerCase();
  return lastSpentAt(payments.filter((item) => item.agent.toLowerCase() === agent));
}

/** The later of two times, either of which may not be known. */
export function later(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** The line in words, for a row with no room for the line and for anyone who cannot see it. */
export function pulseWords(pulse: Pulse, stopped: Stopped | null): string {
  if (pulse === "spending") return "Spending now";
  if (pulse === "resting") return "Resting";
  return stopped === "spent out" ? "Nothing left" : "Ended";
}

/** What has been seen of one agent's spending: the figure, and when it last rose. */
export interface SeenSpending {
  readonly spent: bigint;
  /** In seconds, or `null` if it has not risen since it was first seen. */
  readonly roseAt: number | null;
}

/**
 * Notes what an agent has spent, and says when that figure last rose.
 *
 * A rise is a payment, seen in the same read as the figure, where the feed can be a read or two
 * behind; so it is the freshest sign that an agent is spending. Kept in one place for every screen,
 * under `key`, because a list row that saw the payment and a page opened a moment later must not
 * say different things about the same agent.
 *
 * The first sight of an agent is not a rise: what it spent before the app was looking is not a
 * payment now. A figure that falls is a new allowance for the same agent, which has spent nothing
 * yet, so the time is forgotten with it.
 */
export function noteSpending(seen: Map<string, SeenSpending>, key: string, spent: bigint, now: number = Date.now()): number | null {
  const before = seen.get(key);
  if (before === undefined || spent < before.spent) {
    seen.set(key, { spent, roseAt: null });
    return null;
  }
  if (spent > before.spent) {
    const roseAt = Math.floor(now / 1000);
    seen.set(key, { spent, roseAt });
    return roseAt;
  }
  return before.roseAt;
}
