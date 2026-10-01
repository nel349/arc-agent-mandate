import { useRouter } from "expo-router";
import { useCallback } from "react";
import { ROUTES } from "./routes.ts";

/**
 * Leave this screen: back where the person came from, or to the allowances if they came from nowhere.
 *
 * `router.back()` alone does nothing when there is no history, which in a browser is any screen
 * opened from a link or reloaded. "Back to allowances", Done after a grant and the return after a
 * revoke all sat still there. On a phone there is always a screen underneath, so this is the same
 * as before.
 */
export function useLeave(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(ROUTES.allowances);
  }, [router]);
}
