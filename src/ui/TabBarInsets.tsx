import { createContext, useContext, type ReactNode } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

/**
 * How much room the tab bar takes from the bottom of a tab's screen, on each platform.
 *
 * The two platforms hide the bar from a screen in opposite ways, so one answer cannot serve both.
 *
 * **iOS 26** floats the bar *over* the screen. Its height is not published, so nothing here guesses
 * it: a nested `SafeAreaProvider` renders a native view and reports **that view's** safe area, which
 * inside a tab already has the bar subtracted. Every `useSafeAreaInsets()` below this clears the bar
 * without knowing it exists. That is why this wrapper exists at all.
 *
 * **Android** does not put the bar in the safe area. It is a Material bottom navigation bar laid out
 * edge to edge, and a screen's own content runs underneath it — which is how "New allowance"
 * disappeared entirely rather than merely being covered: pinned to `bottom: 0`, it landed below the
 * visible window. Measured on a device, the bar is 210px on a screen whose density makes that exactly
 * the 80dp Material specifies, so this is the platform's published metric rather than a number
 * somebody eyeballed.
 *
 * Screens ask for it through `useTabBarHeight`, and screens outside the tabs get zero, because there
 * is no bar over them.
 */
const ANDROID_TAB_BAR = 80;

const UnderTabBar = createContext(0);

/** What a screen must leave clear at the bottom for the tab bar. Zero outside the tabs. */
export function useTabBarHeight(): number {
  return useContext(UnderTabBar);
}

export function TabBarInsets({ children }: { readonly children: ReactNode }) {
  return (
    <SafeAreaProvider style={styles.fill}>
      <UnderTabBar.Provider value={Platform.OS === "android" ? ANDROID_TAB_BAR : 0}>
        {children}
      </UnderTabBar.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
