/**
 * Connecting this wallet to a site that wants to show its owner what their agents are doing.
 *
 * The site opens `/connect?return=<url>`, the owner taps Connect, and the wallet sends them back to
 * `<url>` with the wallet's address added to the end. Nothing is signed and nothing is granted: the
 * address is public, and the site uses it only to read what the chain already says about this
 * wallet's agents. What the owner approves is that this particular site may know which wallet is
 * theirs, so the site's host is shown before they tap.
 *
 * Bench sends `return=https://<bench>/#connected/`, so the address lands where its page reads it.
 */

/** A return address the wallet will send an owner to, or why not. */
export type ConnectRequest =
  | { readonly ok: true; readonly url: string; readonly host: string }
  | { readonly ok: false; readonly problem: string };

/**
 * Reads the `return` a site sent. Only a web page may receive the address: any other scheme could
 * hand it to something the owner cannot see.
 */
export function readConnectRequest(returnTo: unknown): ConnectRequest {
  if (typeof returnTo !== "string" || returnTo.length === 0) {
    return { ok: false, problem: "Nothing asked to connect. Open this from the site you want to connect to." };
  }
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return { ok: false, problem: "The site that sent you here gave an address this wallet cannot read." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, problem: "Only a web page can be connected, and this asked to send your address elsewhere." };
  }
  return { ok: true, url: url.toString(), host: url.host };
}

/** Where Connect sends the owner: the site's return address with the wallet's address added. */
export const connectedUrl = (request: { readonly url: string }, wallet: string): string => `${request.url}${wallet}`;

/** Where the last connected site's return address is kept, so the wallet can link back to it. */
export const CONNECTED_SITE_KEY = "connected.site";

/**
 * The site this wallet last connected to, read back from what was kept: its return address and host,
 * or `null` if nothing was kept or what was kept is no longer a page the wallet would send anyone to.
 */
export function readConnectedSite(kept: string | null): { readonly url: string; readonly host: string } | null {
  if (kept === null || kept === "") return null;
  const r = readConnectRequest(kept);
  return r.ok ? { url: r.url, host: r.host } : null;
}

