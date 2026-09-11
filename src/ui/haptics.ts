/**
 * A tap you can feel, at the three moments worth one: an allowance granted, one revoked, and a
 * code read by the camera.
 *
 * Apple asks for haptics that reinforce what the screen already says and are used sparingly, so
 * these are the only three, and each matches the system's own meaning: success for something
 * that landed, warning for something taken away.
 *
 * `expo-haptics` is native, so a build that predates it cannot load it. Required behind a guard,
 * the same way the gradient and the preference store are, so an old build loses the tap and keeps
 * the screen.
 */
type HapticsModule = typeof import("expo-haptics");

const haptics: HapticsModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-haptics") as HapticsModule;
  } catch {
    return null;
  }
})();

/** Something the person asked for has landed. */
export function feelSuccess(): void {
  if (haptics === null) return;
  // A tap that fails to play is not worth a message; the screen has already said what happened.
  haptics.notificationAsync(haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** Something has been taken away, deliberately. */
export function feelWarning(): void {
  if (haptics === null) return;
  haptics.notificationAsync(haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
