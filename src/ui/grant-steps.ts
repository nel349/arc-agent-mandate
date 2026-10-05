/**
 * The order of the grant's questions, asking only what the agent's code left unanswered.
 *
 * A code that carries its app's whole request goes from the scan straight to the card, where every
 * line can still be changed. A typed address, or a code that asks for part, is asked the rest one
 * question at a time. Pure, so the order is tested rather than found on a phone.
 */
export type GrantStep = "agent" | "amount" | "window" | "card" | "done";

/** What is already answered when leaving a step, and whether the person came from the card to change one thing. */
export interface Answered {
  readonly limit: boolean;
  readonly days: boolean;
  /** a change asked for from the card goes back to it, rather than through every question after */
  readonly changing: boolean;
}

/** The step after `from`, given what is answered. */
export function stepAfter(from: Exclude<GrantStep, "card" | "done">, answered: Answered): GrantStep {
  if (from === "agent") return !answered.limit ? "amount" : !answered.days ? "window" : "card";
  if (from === "amount") return answered.changing || answered.days ? "card" : "window";
  return "card";
}
