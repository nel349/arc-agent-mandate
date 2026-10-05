import { stepsOn, type NetworkProfile, type StepId } from "@kuiralabs/mandate-core";

/**
 * The five steps as the connector tells them to the agent the moment it connects: the core's titles and
 * where each happens, then what each means for the agent. Its own module, so a test can read it without
 * starting the connector.
 */

/** What each step means for the agent, after its title. */
const FOR_THE_AGENT = (walletUrl: string): Readonly<Record<StepId, string>> => ({
  wallet: `. It opens in the phone's browser at ${walletUrl}, with nothing to install, and makes a wallet with a passkey.`,
  connect: ". You are connected, so this one is done.",
  grant: ": New allowance, then Scan the agent's code.",
  task: ": they give you the task.",
  watch: ".",
});

/** The steps, numbered, each with where it happens and what it means for the agent. */
export function briefingSteps(network: NetworkProfile, walletUrl: string): string[] {
  const meaning = FOR_THE_AGENT(walletUrl);
  return stepsOn(network).map((step, index) => `${index + 1}. ${step.title} (their ${step.where})${meaning[step.id]}`);
}
