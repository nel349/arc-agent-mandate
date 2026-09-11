import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { AgentNamesProvider } from "../src/ui/agent-names-context.tsx";
import { SessionProvider } from "../src/ui/session-context.tsx";
import { ThemeProvider, useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/** A bar with no fill of its own, over a screen that paints its own ground. */
const TRANSPARENT = "transparent";

/** The receipt's resting height, as a fraction of the screen: the figure and its four rows. */
const RECEIPT_HEIGHT = 0.62;

/** Sized from the shared control scale, so it matches the `?` controls in content. */
const HEADER_ICON = Math.round(tokens.size.control.header * tokens.size.glyphScale);

const styles = StyleSheet.create({
  /**
   * Width, deliberately, and no height.
   *
   * The two axes are owned by different layers, which is why setting both puts the glyph off
   * centre. iOS 26 draws its own glass capsule behind a header item at a fixed 44pt and centres it
   * vertically in the bar. React Navigation, meanwhile, lays our view out **top-aligned** in its
   * own container, whose top sits 4pt below where the capsule starts. So the moment we give the
   * view a height, we are centring the glyph inside our box rather than inside the capsule the
   * eye actually sees, and the two disagree by that 4pt. Left alone, the system centres the glyph
   * for us and the axis is exact.
   *
   * Horizontally the system does not help: the capsule keeps its 44pt minimum while a 24pt glyph
   * sits at the leading edge of it, 6pt shy of centre. A width — and nothing else — closes that.
   *
   * Both figures were measured off the simulator, not reasoned about; an earlier attempt to
   * explain them with font metrics was wrong, and the giveaway was that the error stayed a
   * constant 4pt when the glyph grew by a quarter. Typography scales with the type. Layout does
   * not.
   */
  headerButton: { width: tokens.size.tapTarget, alignItems: "center" },
  /** Android only, and a no-op on iOS: keeps the icon font from adding padding of its own. */
  headerIcon: { includeFontPadding: false },
});

/**
 * The providers wrap the navigator so every screen, including the headers the navigator draws,
 * reads one palette, one wallet and one set of agent names.
 *
 * The session sits above the navigator rather than inside a screen because the app now has more
 * than one: the list, an agent's own screen and the grant sheet all show the same account, and a
 * wallet held by one screen's state is a wallet the next screen cannot see.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <AgentNamesProvider>
          <Navigator />
        </AgentNamesProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

function Navigator() {
  const c = useTheme().color;
  const router = useRouter();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.groundMid },
        headerTintColor: c.paper,
        headerTitleStyle: { color: c.paper },
        headerLargeTitleStyle: { color: c.paper },
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        contentStyle: { backgroundColor: c.groundMid },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Allowances",
          // A large title, as Apple asks of a top-level screen, over the screen's own lit ground.
          // Transparent so the gradient runs to the top edge; iOS draws its own scroll edge
          // effect once content passes beneath the bar.
          headerLargeTitleEnabled: true,
          headerTransparent: true,
          // Both cleared, or the bar keeps the ground colour from `screenOptions` and draws a
          // darker band across the top of the gradient.
          headerStyle: { backgroundColor: TRANSPARENT },
          headerLargeStyle: { backgroundColor: TRANSPARENT },
          // Settings is occasional, so it belongs in the chrome rather than in the content.
          /**
           * A view, because the native option is not available here.
           *
           * `unstable_headerRightItems` is the right answer — it hands iOS a real
           * `UIBarButtonItem` and the system owns shape, padding, tint and alignment. React
           * Navigation 7.18 accepts it, but `react-native-screens` 4.16, which Expo SDK 54 pins,
           * implements neither the JS nor the native side and drops the prop silently. Passing it
           * removed the button altogether. Revisit when screens supports it.
           *
           * So: a glyph and a width, with no background of our own. iOS 26 already draws a
           * capsule around header items, and a second one of ours inside it reads as a box within
           * a box. `IconButton` is not reused here for exactly that reason — it brings its own
           * ring and its own centring, both of which the system is already providing. See
           * `headerButton` above for which axis belongs to whom.
           *
           * `hitSlop` restores the touch target the glyph is too small to fill on its own.
           */
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/settings")}
              style={styles.headerButton}
              hitSlop={Math.round((tokens.size.tapTarget - HEADER_ICON) / 2)}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Ionicons
                name="settings-outline"
                size={HEADER_ICON}
                color={c.paper}
                style={styles.headerIcon}
              />
            </Pressable>
          ),
        }}
      />
      {/* Pushed: drilling into one item of the list. Its title is the agent's name, set by the
          screen once it knows it. */}
      <Stack.Screen
        name="agent/[address]"
        options={{
          title: "",
          headerTransparent: true,
          headerStyle: { backgroundColor: TRANSPARENT },
          headerBackTitle: "Allowances",
        }}
      />
      {/* Full screen, drawing its own bar: a flow of several steps, as Kuira's send is, and as
          Apple places a multi-step task. Each step takes the whole screen, and the bar's Cancel
          and Back are the ways out. */}
      <Stack.Screen name="grant" options={{ presentation: "fullScreenModal", headerShown: false }} />
      <Stack.Screen name="activity" options={{ title: "Activity", headerBackTitle: "Back" }} />
      {/* Half height: a receipt is a glance at one row, with the list still showing above it. */}
      <Stack.Screen
        name="receipt"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: [RECEIPT_HEIGHT, 1],
          sheetGrabberVisible: true,
          title: "",
        }}
      />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="dev" options={{ title: "Developer harness" }} />
      <Stack.Screen name="preview" options={{ title: "Component preview" }} />
    </Stack>
  );
}
