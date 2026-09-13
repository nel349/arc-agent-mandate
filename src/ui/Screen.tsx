import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTabBarHeight } from "./TabBarInsets.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * The lit ground every screen sits on.
 *
 * Light, not colour: three neutral stops of the theme's own temperature, falling from the top
 * right to the bottom left. It exists so the glass above it has real value variation to refract —
 * a panel over a flat fill is just a lighter rectangle, which is the mistake several earlier
 * versions of this design made.
 *
 * The mockup used radial falloffs; React Native has no radial gradient, so this is the diagonal
 * approximation. At phone size the difference does not show.
 *
 * **It scrolls only when there is more than fits.** The content used to be stretched to the full
 * height of the screen, and iOS then added the header and the home indicator on top of that, so
 * every screen was a few dozen points too tall and scrolled with nothing to reveal. Now the content
 * is as tall as what is in it, and iOS's rubber band is off, so a screen that fits sits still.
 */

/**
 * `expo-linear-gradient` is native, so a build that predates it has no module to load. Required
 * behind a guard rather than imported, because a static import fails at module scope where nothing
 * can catch it — and this component is the root of every screen, so that failure is the whole app.
 *
 * Without it the ground is a flat fill: the light is gone and the glass reads flatter, but every
 * screen still works.
 */
const Gradient: null | ((props: Record<string, unknown>) => ReactNode) = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-linear-gradient").LinearGradient;
  } catch {
    console.warn("[ui] expo-linear-gradient unavailable — flat ground. Rebuild the dev client.");
    return null;
  }
})();

/** Fully transparent, as an eight-digit hex the gradient can blend from without passing through grey. */
const CLEAR = "00";

export function Screen({
  children, footer, header, centered = false, fill = false, onRefresh, refreshing = false,
}: {
  readonly children: ReactNode;
  /**
   * Pinned to the bottom, above the home indicator: the screen's main action, where a thumb
   * already is on a large phone. Content scrolls beneath it and fades out under it, so the button
   * is never read as sitting on top of a row.
   */
  readonly footer?: ReactNode;
  /**
   * A bar the screen draws for itself, above the content, for full-screen flows that have no
   * navigation bar of their own. It clears the status bar itself.
   */
  readonly header?: ReactNode;
  /**
   * The content sits in the middle of the space between the top and the footer, as a welcome does.
   * It still scrolls if a large text size makes it taller than the screen, because text that cannot
   * be reached is worse than a layout that moves.
   *
   * Centring works by making the content exactly as tall as the screen, so here the safe areas are
   * applied as padding rather than left to iOS: iOS adds its insets on top of the content, and the
   * two together were what made a screen that fitted scroll anyway.
   */
  readonly centered?: boolean;
  /**
   * The content fills the screen and does not scroll, and moves up out of the keyboard's way. For a
   * screen built around one thing that should take all the room there is, like an amount being
   * typed: it grows into the space rather than sitting at the top of it.
   */
  readonly fill?: boolean;
  /**
   * Read again, because the person asked. Pulling down is how a phone says "are you sure that is
   * still true", and every screen here shows something the chain can change without this app being
   * told: an allowance an agent is spending, a badge minted while the tab was open. The badge was
   * the one that caught us, because that read is the only one that never polls.
   *
   * Given here rather than per screen because this is where the scroll view is, and a screen that
   * built its own would lose the ground, the insets and the footer this one measures.
   *
   * Has no effect on a `fill` screen: there is no scroll view to pull.
   */
  readonly onRefresh?: () => void;
  /** Whether that read is still running, so the control spins until there is an answer. */
  readonly refreshing?: boolean;
}) {
  const c = useTheme().color;
  const insets = useSafeAreaInsets();
  // Zero on iOS, where the bar is already inside `insets`, and zero outside the tabs on both.
  const underTabBar = useTabBarHeight();
  /**
   * What the system takes from the bottom, on the platform that does not give it back.
   *
   * `contentInsetAdjustmentBehavior="automatic"` below is **iOS only**: there, UIKit pads a scroll
   * view for the home indicator itself and adding our own would count it twice. Android ignores the
   * prop entirely, so content simply runs under the gesture bar — which sliced the last control of
   * Settings in half, a screen that has no footer to pad it and no tab bar over it either.
   */
  const systemBottom = Platform.OS === "android" ? insets.bottom : 0;
  // Measured rather than assumed, so a footer of one button or two leaves exactly enough room.
  const [footerHeight, setFooterHeight] = useState(0);
  const measure = (event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height);

  const content = fill ? (
    <KeyboardAvoidingView behavior="padding" style={styles.fill}>
      <View style={[styles.content, styles.fill, { paddingBottom: footer !== undefined ? footerHeight : insets.bottom + tokens.space.base }]}>
        {children}
      </View>
    </KeyboardAvoidingView>
  ) : (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        centered
          ? {
              flexGrow: 1,
              justifyContent: "center",
              // A header already clears the status bar, so only a bare screen pads for it.
              paddingTop: header !== undefined ? tokens.space.lg : insets.top,
              paddingBottom: Math.max(footerHeight, insets.bottom),
            }
          // iOS already adds the home indicator to the bottom inset here, and the footer's height
          // includes it too, so it is taken out once rather than counted twice.
          : footer !== undefined
            ? { paddingBottom: Math.max(footerHeight - insets.bottom, tokens.space.lg) }
            // No footer, so nothing else is holding the end of the content clear of the tab bar or
            // of the system's own bar. On iOS both terms are zero and the inset behaviour handles it.
            : { paddingBottom: underTabBar + systemBottom },
      ]}
      // `automatic` lets iOS place content under a large title and above the home indicator, and
      // lets the title collapse as the list scrolls. A centred screen has no title to sit under.
      contentInsetAdjustmentBehavior={centered ? "never" : "automatic"}
      // Off, so a screen whose content fits does not rubber-band as if there were more below --
      // except where a pull means something. iOS will not start a pull on a scroll view that cannot
      // bounce, so without this the control exists and can never be reached on exactly the screens
      // that need it most: the short ones, like a tab holding a single badge.
      alwaysBounceVertical={onRefresh !== undefined}
      refreshControl={onRefresh === undefined ? undefined : (
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          // iOS tints one spinner; Android takes a list of colours and a disc behind them. Both are
          // named from the theme, so the control belongs to this app rather than to the platform's
          // default blue on white.
          tintColor={c.dim}
          colors={[c.paper]}
          progressBackgroundColor={c.groundHigh}
        />
      )}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );

  const bar = footer === undefined ? null : (
    <View
      onLayout={measure}
      pointerEvents="box-none"
      style={[styles.footer, { paddingBottom: insets.bottom + underTabBar + tokens.space.sm }]}
    >
      {Gradient === null ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.groundLow }]} />
      ) : (
        <Gradient
          pointerEvents="none"
          colors={[`${c.groundLow}${CLEAR}`, c.groundLow]}
          locations={[0, 0.4]}
          style={StyleSheet.absoluteFill}
        />
      )}
      {footer}
    </View>
  );

  if (Gradient === null) {
    return <View style={[styles.fill, { backgroundColor: c.groundMid }]}>{header}{content}{bar}</View>;
  }
  return (
    <Gradient
      colors={[c.groundHigh, c.groundMid, c.groundLow]}
      locations={[0, 0.42, 1]}
      start={{ x: 0.9, y: 0 }}
      end={{ x: 0.1, y: 1 }}
      style={styles.fill}
    >
      {header}
      {content}
      {bar}
    </Gradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // As tall as what is in it. `flexGrow: 1` here was the bug: stretched to the screen, then given
  // iOS's insets on top, every screen was taller than itself.
  /**
   * The screen's gutter, and the rhythm between the blocks stacked down it.
   *
   * **The gap is never tighter than a card's own padding.** It used to be `md` (12) against a
   * `Surface` padded at `base` (16), so two separate cards sat closer to each other than each card's
   * contents sat to its own edge — and a boundary that is tighter than what it contains stops
   * reading as a boundary at all. That is the muddle, measured: 57.1dp here, 29.0dp before a section
   * heading, neither of them a step on the scale, both of them the sum of two containers paying for
   * the same space.
   *
   * So: 20 at the edge of the screen, 16 between blocks, 16 inside a card, 12 between a card's own
   * rows. Monotonic, every value a step, and the same on both platforms.
   */
  content: { padding: tokens.space.lg, gap: tokens.space.base },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xl,
    gap: tokens.space.sm,
  },
});
