import type { ReactNode } from "react";

/**
 * `expo-linear-gradient` is native, so a build that predates it has no module to load. Required
 * behind a guard rather than imported, because a static import fails at module scope where nothing
 * can catch it — and the screen frame using it is the root of every screen, so that failure is the whole app.
 *
 * Without it the ground is a flat fill: the light is gone and the glass reads flatter, but every
 * screen still works.
 */
export const Gradient: null | ((props: Record<string, unknown>) => ReactNode) = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-linear-gradient").LinearGradient;
  } catch {
    console.warn("[ui] expo-linear-gradient unavailable — flat ground. Rebuild the dev client.");
    return null;
  }
})();
