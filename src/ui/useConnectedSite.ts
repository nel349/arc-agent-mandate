import { useEffect, useState } from "react";
import { CONNECTED_SITE_KEY, readConnectedSite } from "./connect.ts";
import { readPreference } from "./preference-store.ts";

/**
 * The site this wallet last connected to, so a screen can link back to it: the agent's page to the
 * agent on that site, Rewards to where reputation is earned. `null` until one has been connected.
 */
export function useConnectedSite(): { readonly url: string; readonly host: string } | null {
  const [site, setSite] = useState<{ readonly url: string; readonly host: string } | null>(null);
  useEffect(() => {
    let current = true;
    void readPreference(CONNECTED_SITE_KEY).then((kept) => { if (current) setSite(readConnectedSite(kept)); });
    return () => { current = false; };
  }, []);
  return site;
}
