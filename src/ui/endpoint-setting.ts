import { readEndpoint, useArcRpcUrl } from "../arc/endpoint.ts";
import { readPreference, writePreference } from "./preference-store.ts";

/**
 * The endpoint this phone was given, remembered between launches.
 *
 * The app works with no endpoint of its own — see `src/arc/endpoint.ts` for the chain of three —
 * so everything here is about the first of those three, and nothing here is required. Somebody who
 * has an endpoint of their own pastes it in Settings and stops sharing a rate limit with everyone
 * else; somebody who does not never sees a consequence.
 *
 * Kept apart from the screen so the rules are tested without a renderer, and apart from
 * `src/arc/endpoint.ts` so that module stays free of storage and can be read by Node.
 */
const KEY = "arc.endpoint";

/**
 * Point Arc's reads at whatever this phone was given, at launch.
 *
 * Returns what it found, so a screen can show it without reading storage a second time. Reads that
 * happen before this lands use the built-in endpoint, which is correct rather than merely tolerable:
 * the alternative is holding the first frame of a wallet on a disk read.
 */
export async function applyStoredEndpoint(): Promise<string | null> {
  const stored = await readPreference(KEY);
  // Validated on the way out, not just on the way in: storage outlives the rule that wrote to it,
  // and a value that no longer passes must not become the endpoint an account is read through.
  const entry = stored === null || stored.length === 0 ? null : readEndpoint(stored);
  const url = entry !== null && "url" in entry ? entry.url : null;
  useArcRpcUrl(url);
  return url;
}

/** Keep an endpoint and use it from the next read on, or `null` to go back to the built-in one. */
export async function chooseEndpoint(url: string | null): Promise<void> {
  useArcRpcUrl(url);
  await writePreference(KEY, url ?? "");
}

/**
 * The part of an endpoint that is safe to put on a screen.
 *
 * **Never the whole URL.** A paid endpoint carries its key in the path — `…/v2/<key>` — so showing
 * the address someone pasted would put their key on the screen, and in any screenshot of it. The
 * host says which endpoint is in use, which is the only thing being asked.
 */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "an endpoint";
  }
}

/** What the Network row says about where reads are going. */
export function describeEndpoint(own: string | null): string {
  if (own === null) {
    return "Reads use the endpoint the app came with. Nothing needs setting up.";
  }
  return `Reads use ${endpointHost(own)}. Your key stays on this phone.`;
}
