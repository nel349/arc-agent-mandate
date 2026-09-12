import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import type { Address } from "viem";
import { badgesOf, type Badge } from "../arc/badges.ts";
import { cohortBadgeName, readBadgeMetadata } from "./badge-metadata.ts";

declare const __DEV__: boolean;

/**
 * What this wallet has been given, with the picture each badge carries.
 *
 * Read when the screen opens rather than polled: a badge is minted once and never changes, so the
 * ten-second rhythm the allowances and the feed keep would be ten seconds of asking a question whose
 * answer is already known. Coming back to the app reads again, since a badge may have arrived while
 * it was away.
 *
 * Kept out of the screen so the screen renders what it is given: badges, or nothing, or a sentence
 * about the chain. See `badgesOf` for why finding them costs so little.
 */

/** A badge as the screen shows it: its number, its name, and the picture it carries. */
export interface EarnedBadge extends Badge {
  readonly name: string;
  readonly svg: string | null;
}

export interface EarnedBadges {
  readonly badges: readonly EarnedBadge[];
  readonly loading: boolean;
  /** Set when the chain or the badge's own address could not be read. The rows already shown stay. */
  readonly error: string | null;
  refresh(): void;
}

const UNREADABLE = "Could not read your badges from Arc just now. It will try again.";

/** The badge's own description, from the address its `tokenURI` gives. Null when it cannot be read. */
async function describe(badge: Badge): Promise<EarnedBadge> {
  const plain: EarnedBadge = { ...badge, name: cohortBadgeName(badge.number), svg: null };
  try {
    const response = await fetch(badge.uri, { headers: { accept: "application/json" } });
    if (!response.ok) {
      if (__DEV__) console.warn(`[badges] ${badge.uri} answered ${response.status}; drawing the number only`);
      return plain;
    }
    const art = readBadgeMetadata(await response.json());
    return { ...plain, name: art?.name ?? plain.name, svg: art?.svg ?? null };
  } catch (cause) {
    // The picture is a convenience; the badge and its number came from the chain. Said out loud, so
    // a badge drawn as a bare plate says why rather than looking like the art that was meant.
    if (__DEV__) console.warn(`[badges] ${badge.uri} could not be read; drawing the number only`, cause);
    return plain;
  }
}

export function useBadges(wallet: Address | null): EarnedBadges {
  const [badges, setBadges] = useState<readonly EarnedBadge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const refresh = useCallback(() => setRefreshCount((n) => n + 1), []);

  /**
   * Read again when the app comes back, because a badge can be minted while it is away. Nothing
   * polls: a badge is minted once and never changes, so the ten-second rhythm the allowances and the
   * feed keep would be ten seconds of asking a question whose answer is already known. Here rather
   * than in the screen, as every other lifecycle read in this app is.
   */
  useEffect(() => {
    const watch = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => watch.remove();
  }, [refresh]);

  useEffect(() => {
    let current = true;
    setError(null);
    if (wallet === null) {
      setBadges([]);
      // Cleared here too: signing out mid-read otherwise left the tab spinning for ever.
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const held = await badgesOf(wallet);
        const described = await Promise.all(held.map(describe));
        if (!current) return;
        setBadges(described);
      } catch {
        if (!current) return;
        setError(UNREADABLE);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [wallet, refreshCount]);

  return { badges, loading, error, refresh };
}
