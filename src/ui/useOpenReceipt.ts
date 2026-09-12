import { useRouter } from "expo-router";
import { useCallback } from "react";
import type { Activity } from "../arc/activity.ts";
import { receiptRoute } from "./routes.ts";

/**
 * Opening one row's receipt, from wherever the row is.
 *
 * Three screens show the feed — home, an agent's own screen, and the full activity list — and each
 * had written the same push, spelling the receipt's two parameters by hand. A mistyped parameter is
 * not a type error and not a crash: it is a receipt that opens empty, found by somebody using the
 * app. One hook, one route, and the two screens that only had a router for this no longer need one.
 */
export function useOpenReceipt(): (item: Activity) => void {
  const router = useRouter();
  return useCallback((item: Activity) => router.push(receiptRoute(item)), [router]);
}
