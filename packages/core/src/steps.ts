import type { NetworkProfile } from "./networks.ts";

/**
 * The five steps a person takes to let an agent spend for them, in one place.
 *
 * Every program that shows them (the wallet, the connector's briefing, a page like Bench's, the maze or
 * POD) reads this frame, so the order, where each step happens and what it means cannot drift between
 * them. An app may say a step in its own fuller words; it does not change the steps.
 */

export type StepId = "wallet" | "connect" | "grant" | "task" | "watch";
/** which device the person holds for a step */
export type Where = "phone" | "laptop";

export interface Step {
  readonly id: StepId;
  readonly where: Where;
  readonly title: string;
}

const STEPS: readonly { readonly id: StepId; readonly where: Where; readonly title: (network: NetworkProfile) => string }[] = [
  { id: "wallet", where: "phone", title: (network) => `Get the app, and add test ${network.coin.symbol}` },
  { id: "connect", where: "laptop", title: () => "Connect your agent" },
  { id: "grant", where: "phone", title: () => "Scan to grant" },
  { id: "task", where: "laptop", title: () => "Tell your agent to play" },
  { id: "watch", where: "phone", title: () => "Watch it spend, revoke any time" },
];

/** The five steps on a network, in order, with its own coin named where money is. */
export const stepsOn = (network: NetworkProfile): readonly Step[] =>
  STEPS.map(({ id, where, title }) => ({ id, where, title: title(network) }));
