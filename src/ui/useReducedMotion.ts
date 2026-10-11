import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Whether this person has asked their device for less motion.
 *
 * One answer for the whole app, kept here and followed, because the setting can change while the
 * app is open. Every component that moves asks, and there are several on a screen; each of them
 * subscribing for itself went wrong in a browser, where React Native's listeners are kept by the
 * text of the function given, so three components shared one and removing a card unsubscribed
 * another.
 *
 * In a browser the answer is there at once, so the first frame is already the right one. On a phone
 * it arrives a moment later, and until it does it is taken as asked for: a screen that starts still
 * and then moves is fine, and one that moves at somebody who asked it not to is what the setting is
 * for.
 */
let reduced: boolean | null = null;
const watching = new Set<() => void>();
let following = false;

function set(next: boolean): void {
  if (reduced === next) return;
  reduced = next;
  for (const tell of watching) tell();
}

function follow(): void {
  if (following) return;
  following = true;
  if (Platform.OS === "web") {
    // A browser too old to be asked has expressed no preference, which is not the same as asking.
    const query = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    set(query?.matches ?? false);
    query?.addEventListener?.("change", (event) => set(event.matches));
    return;
  }
  AccessibilityInfo.isReduceMotionEnabled()
    .then(set)
    // No answer is no reason to stay still for good; the setting's own event corrects it if not.
    .catch(() => set(false));
  AccessibilityInfo.addEventListener("reduceMotionChanged", set);
}

function subscribe(tell: () => void): () => void {
  follow();
  watching.add(tell);
  return () => { watching.delete(tell); };
}

/** Asked before the first subscription too, so a browser's first frame already has the answer. */
const current = (): boolean => { follow(); return reduced ?? true; };

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, current, () => true);
}
