import type { Feedback } from "../arc/reputation.ts";
import { shortAddress } from "./mandate-format.ts";

/**
 * Turning a score on chain into a sentence.
 *
 * Kept apart from the screen so the wording is tested, and apart from the reader so the chain module
 * never decides how something reads to a person.
 */

/**
 * The units the maze writes, stated on chain rather than assumed here.
 *
 * A score is meaningless without them: 100 could be a count, a cost or a rank. The registry carries
 * the units in the record's second tag, so a reader that ignores them is guessing.
 */
const EFFICIENCY = "efficiency-pct";

/** A perfect score on that scale: the shortest route the maze has. */
const PERFECT = 100;

/** The score as a number, with its decimal places applied. */
export function scoreOf(feedback: Feedback): number {
  return feedback.value / 10 ** feedback.decimals;
}

/** The figure, in the units its writer recorded. */
export function scoreLabel(feedback: Feedback): string {
  const score = scoreOf(feedback);
  return feedback.tag2 === EFFICIENCY ? `${score}% efficiency` : `${score}`;
}

/**
 * What the figure means, for the one scale we can speak for, and nothing for any other.
 *
 * Higher is better here, which is worth saying: steps and cost both improve as they shrink, and an
 * agent's owner reading "100" next to a maze has no way to know which kind of number this is.
 */
export function scoreMeaning(feedback: Feedback): string | null {
  if (feedback.tag2 !== EFFICIENCY) return null;
  return scoreOf(feedback) >= PERFECT
    ? "The shortest route there is."
    : "Higher is better. 100% is the shortest route.";
}

/**
 * Who wrote it, named so it is plainly not the wallet reading it.
 *
 * The registry refuses feedback from an agent's owner or operators, so this is always somebody
 * else — which is the whole reason the score counts for anything.
 */
export function writtenBy(feedback: Feedback): string {
  const who = feedback.tag1.length > 0 ? feedback.tag1 : shortAddress(feedback.client);
  return `Written by ${who}, which the agent cannot do for itself.`;
}
