import type { NetworkProfile } from "@kuiralabs/mandate-core";
import { choiceOf, NETWORK_CHOICE_KEY, networkOfChoice } from "./network-choice.ts";
import { readPreference, writePreference } from "./preference-store.ts";

/** The network this phone last showed. */
export async function loadNetworkChoice(): Promise<NetworkProfile> {
  return networkOfChoice(await readPreference(NETWORK_CHOICE_KEY));
}

export async function saveNetworkChoice(network: NetworkProfile): Promise<void> {
  await writePreference(NETWORK_CHOICE_KEY, choiceOf(network));
}
