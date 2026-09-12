import { Redirect } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { ROUTES } from "../../src/ui/routes.ts";
import { useSession } from "../../src/ui/session-context.tsx";
import { useTheme } from "../../src/ui/theme-context.tsx";

/**
 * The two things this app is: what your agents may spend, and what they have earned you.
 *
 * A **native** tab bar rather than one drawn in JavaScript. On iOS 26 the system draws it as the
 * floating capsule everything else on the phone uses, it minimises as a list scrolls, it carries the
 * platform's own blur, and it is accessible without us reimplementing any of that. A JS tab bar
 * would be ours to keep in step with the OS for ever, which is the kind of work that is never done.
 *
 * Colour comes from the theme for the **foreground only** — the glyphs and labels — and the glyphs are
 * SF Symbols so they match the weight of the system's own.
 *
 * **The bar's own fill is the platform's, deliberately.** It used to carry `backgroundColor` and
 * `blurEffect` of ours, and the result flickered white: iOS keeps *two* appearances, and
 * `expo-router` only applies ours to one of them. `createScrollEdgeAppearanceFromOptions` replaces
 * both with `'none'` and `null` unless `disableTransparentOnScrollEdge` is set, and a null
 * background resolves to the system's own material — so the bar wore our dark fill while a list was
 * scrolled under it and the system's light one at the top of the list, swapping as the scroll
 * position changed and differing from screen to screen.
 *
 * Setting `disableTransparentOnScrollEdge` would force ours into both. Letting the platform draw its
 * own is better: it is the same argument as using a native bar at all, it keeps the transparency
 * Apple intends at a scroll edge, and it cannot fall out of step. What makes it dark is the app
 * being dark — `userInterfaceStyle` in `app.json`, which is also what stops the header's glass
 * capsule rendering light behind the settings gear. Both palettes here are dark, so there is nothing
 * for it to contradict.
 *
 * Each tab owns a stack of its own (`index/_layout.tsx`, `rewards/_layout.tsx`), which is what keeps
 * the large titles and lets a screen pushed from one tab stay in that tab. Anything modal — the grant
 * flow, a receipt, an agent's own screen — is pushed by the root stack, over the bar.
 */
export default function TabsLayout() {
  const c = useTheme().color;
  const { wallet } = useSession();

  // Both tabs are about a wallet's money, so without a wallet there is nothing for either to show
  // and no bar worth drawing. Gated here rather than in the allowances screen so that Rewards is
  // covered by the same rule — a branch inside one screen left the bar itself on display.
  if (wallet.account === null) return <Redirect href={ROUTES.welcome} />;

  return (
    <NativeTabs
      tintColor={c.paper}
      iconColor={{ default: c.dim, selected: c.paper }}
      // The bar gets out of the way while a list is being read, and comes back on the way up.
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "creditcard", selected: "creditcard.fill" }} />
        <Label>Allowances</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rewards">
        <Icon sf={{ default: "rosette", selected: "rosette" }} />
        <Label>Rewards</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
