import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Share } from "react-native";

/** How long the button says "Copied" before it says "Share address" again. */
const COPIED_FOR_MS = 1_600;

const SHARE = "Share address";
const COPIED = "Copied";

/**
 * Sharing an address: the share sheet where there is one, and the clipboard where there is not.
 *
 * On the web `Share.share` is the browser's `navigator.share`, which many desktop browsers do not
 * have; there it rejected and the button did nothing. Copying is what a person wanted from it on a
 * laptop anyway: the address, somewhere they can paste it. A share sheet the person closes is not
 * an error, so nothing is said about it.
 */
export function useShareAddress(address: string) {
  const [title, setTitle] = useState(SHARE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const share = useCallback(async () => {
    const browser = Platform.OS === "web" ? globalThis.navigator : undefined;
    if (browser !== undefined && typeof browser.share !== "function") {
      try {
        await browser.clipboard.writeText(address);
      } catch {
        return;
      }
      setTitle(COPIED);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setTitle(SHARE), COPIED_FOR_MS);
      return;
    }
    try {
      await Share.share({ message: address });
    } catch {
      // Closed without sharing.
    }
  }, [address]);

  return { title, share };
}
