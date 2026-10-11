import { Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArcRing } from "../src/ui/ArcRing.tsx";
import { Button } from "../src/ui/Button.tsx";
import { ERROR_LINES, Note } from "../src/ui/Note.tsx";
import { WORDMARK } from "../src/ui/product.ts";
import { ROUTES } from "../src/ui/routes.ts";
import { Screen } from "../src/ui/Screen.tsx";
import { unitOf } from "../src/ui/coin.ts";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";
import { WelcomeExample } from "../src/ui/WelcomeExample.tsx";
import { exampleLayout } from "../src/ui/welcome-demo.ts";

/**
 * The first screen anyone sees, and the only one that exists before there is a wallet.
 *
 * **Outside the tabs on purpose.** It used to be a branch inside the allowances tab, which meant the
 * native tab bar drew underneath it: somebody who had not yet created a wallet was offered
 * Allowances and Rewards, two tabs that can only be empty, before being offered a wallet. A screen
 * that precedes the app does not belong inside the app's navigation.
 *
 * The gate is two redirects that cannot both fire: the tab group sends anyone with no account here,
 * and this screen sends anyone with an account back. Nothing polls and nothing decides twice.
 */
export default function WelcomeScreen() {
  const { wallet } = useSession();

  // Reopening a remembered wallet takes a moment, and showing two big buttons during it puts
  // "Create a wallet" in front of somebody who already has one.
  if (wallet.restoring) return <Opening />;
  if (wallet.account !== null) return <Redirect href={ROUTES.allowances} />;
  return <Welcome />;
}

/**
 * What the app is for, before asking for anything.
 *
 * It shows the product working before it asks for a wallet: the name, an example of an agent
 * spending down an allowance and being refused past it, and one sentence. "Create a wallet" is a big
 * ask from an app that has not yet shown why.
 *
 * It used to be a still ring over a paragraph, with the name nowhere on it, and before that "No
 * wallet yet" over two buttons.
 */
function Welcome() {
  const { wallet } = useSession();
  const c = useTheme().color;
  /**
   * Which of the two was tapped, so only that one spins. Both used to take `wallet.busy`, and
   * tapping either put a spinner on both.
   */
  const [chosen, setChosen] = useState<"create" | "signIn" | null>(null);
  const insets = useSafeAreaInsets();
  // On the smallest phones the second sentence and the line under the buttons give way, so the
  // headline is not behind the buttons. The same measure the example card draws by.
  const { tiny } = exampleLayout(useWindowDimensions().height, tokens.size.shortWindow, tokens.size.tinyWindow);
  const working = (which: "create" | "signIn") => wallet.busy && chosen === which;

  return (
    <Screen
      footer={
        <>
          {/* Above the buttons that caused it, where it cannot be under them: below the sentence it
              was behind the footer on a short phone, and a cancelled passkey showed nothing. */}
          {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
          <Button
            tier="solid"
            title="Create a wallet"
            onPress={() => { setChosen("create"); wallet.create(); }}
            busy={working("create")}
            disabled={wallet.busy}
          />
          <Button
            title="I already have a passkey"
            onPress={() => { setChosen("signIn"); wallet.signIn(); }}
            busy={working("signIn")}
            disabled={wallet.busy}
          />
          {!tiny && (
            <Text style={[styles.opensWith, { color: c.dim }]}>
              Opens with {OPENS_WITH}. No password, nothing to write down.
            </Text>
          )}
        </>
      }
    >
      {/* Android draws under its status bar, and this is the one screen with no bar of its own and
          nothing centring it clear; iOS insets the scroll view itself. */}
      {Platform.OS === "android" && <View style={{ height: insets.top }} />}
      <Wordmark />
      <WelcomeExample unit={unitOf(wallet.network)} />
      <View style={styles.say}>
        <Text style={[styles.headline, { color: c.paper }]} accessibilityRole="header">
          {HEADLINE}
        </Text>
        {!tiny && (
          <Text style={[styles.body, { color: c.muted }]}>
            Give it a limit and an end date. It cannot spend past either, each payment shows here within seconds, and you can stop it at any moment.
          </Text>
        )}
      </View>
    </Screen>
  );
}

/** The name, as a mark: the ring beside it. The first thing on the first screen, where it was missing. */
function Wordmark() {
  const c = useTheme().color;
  return (
    <View style={styles.wordmark} accessible accessibilityRole="header" accessibilityLabel={WORDMARK}>
      <ArcRing spent={MARK_RING} size={tokens.size.ring.wordmark} label="" />
      <Text style={[styles.name, { color: c.paper }]}>{WORDMARK}</Text>
    </View>
  );
}

/**
 * What unlocks the wallet, said as the person will meet it. An iPhone's passkey is Face ID; in a
 * browser or on Android it is whatever the device uses, a fingerprint, a face, a screen lock, or a
 * phone held up to a laptop, so it is named as the passkey it is.
 */
const OPENS_WITH = Platform.OS === "ios" ? "Face ID" : "a passkey";

/**
 * Between launch and the wallet: the name, and what is happening.
 *
 * The system's own spinner, as everywhere else something is being waited for. The heartbeat line
 * is not used for it: that line says an agent is spending, and nothing is.
 */
function Opening() {
  const c = useTheme().color;
  return (
    <Screen centered>
      <View style={styles.opening}>
        <Wordmark />
        <ActivityIndicator color={c.untested} accessibilityLabel="Opening your wallet" />
        <Text style={[styles.opensWith, { color: c.dim }]}>Opening your wallet</Text>
      </View>
    </Screen>
  );
}

/** The last three words are kept together, so a wide window does not break the line as "beat / by beat". */
const HEADLINE = "Watch your agent spend, beat\u00a0by\u00a0beat.";

/** Enough of the ring gone to read as a limit partly used, which is the whole idea in one shape. */
const MARK_RING = 0.35;

const styles = StyleSheet.create({
  wordmark: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  name: tokens.type.wordmark,
  say: { gap: tokens.space.sm, paddingTop: tokens.space.xs },
  headline: tokens.type.display,
  body: tokens.type.subheadline,
  opensWith: { ...tokens.type.caption, textAlign: "center" },
  opening: { alignItems: "center", gap: tokens.space.base, paddingHorizontal: tokens.space.xl },
});
