import { arcTestnet } from "./chain.ts";

/**
 * Which endpoint Arc is read through, and how a person can change it.
 *
 * Three answers, in order, and every one of them has to work on its own:
 *
 * 1. **One this phone was given**, pasted into Settings and kept here. Nothing is built into the app
 *    and nothing is shared: a person, or a judge, brings an endpoint of their own.
 * 2. **The one this build carries**, from `EXPO_PUBLIC_ALCHEMY_ARC_TESTNET`. Expo inlines it, so it ships
 *    inside the app and can be read out of a build — which is why it belongs in `.env`, never in the
 *    repository, and is rotatable. It exists so that somebody who installs the app and does nothing
 *    else gets a fast endpoint rather than a shared one that rate-limits.
 * 3. **Arc's public endpoint**, which is what a fresh clone with no `.env` uses. Everything works
 *    here too, a little slower and subject to the limit the whole network shares.
 *
 * Off the phone — the tests, the forked chains they build, the connector, the scripts — `.env` is
 * read by Node instead, under `ARC_TESTNET_RPC_URL`, and never inlined into anything.
 */

/** What this build carries, or the public endpoint. Read once: an inlined value cannot change. */
export const BUILT_IN_ARC_RPC: string =
  process.env["EXPO_PUBLIC_ALCHEMY_ARC_TESTNET"]
  ?? process.env["ARC_TESTNET_RPC_URL"]
  ?? arcTestnet.rpcUrls.default.http[0];

/** Arc's own, named so a screen can say which of the two a person is on. */
export const PUBLIC_ARC_RPC: string = arcTestnet.rpcUrls.default.http[0];

/**
 * The calls that ask for a *span* of blocks rather than one point in time.
 *
 * These are the only ones an endpoint refuses on size, and they are why the endpoint a build carries
 * cannot simply be used for everything. A provider's free plan commonly allows a range of ten blocks;
 * this app reads in windows of ten thousand, because Arc produces blocks faster than a feed could
 * page through them otherwise. Arc's own endpoint allows the large window and rate-limits instead.
 *
 * So the two kinds of read want different endpoints, and `arcPublicClient` routes them: see
 * `src/arc/client.ts`, which sends a refused range to Arc's own and remembers that it had to.
 */
const RANGE_METHODS: ReadonlySet<string> = new Set(["eth_getLogs"]);

export const asksForARange = (method: string): boolean => RANGE_METHODS.has(method);

/** Set when this phone has been given an endpoint of its own. */
let chosen: string | null = null;

/** The endpoint in use now. */
export function arcRpcUrl(): string {
  return chosen ?? BUILT_IN_ARC_RPC;
}

/** Whether reads are going somewhere this phone was told about, rather than what the build carries. */
export function usingOwnEndpoint(): boolean {
  return chosen !== null;
}

/**
 * Point Arc's reads at an endpoint of this phone's own, or back at the built-in one with `null`.
 *
 * Applied to the live client through `arcPublicClient`, which asks for this on every request rather
 * than holding a URL, so a change takes effect on the next read with nothing to restart.
 */
export function useArcRpcUrl(url: string | null): void {
  chosen = url;
}

/** An endpoint a person typed, or what is wrong with it. Kept pure so the rule is tested, not hoped. */
export type EndpointEntry = { readonly url: string } | { readonly problem: string };

export function readEndpoint(typed: string): EndpointEntry {
  const text = typed.trim();
  if (text.length === 0) return { problem: "Paste an endpoint, or leave it empty to use the default." };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { problem: "That is not a web address. It should start with https://" };
  }
  // https only: an endpoint is asked for an account's balance and its allowances, and plain http
  // would put both in the open on whatever network the phone is on.
  if (parsed.protocol !== "https:") return { problem: "The address has to start with https://" };
  return { url: parsed.toString() };
}
