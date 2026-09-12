import { useEffect } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from "react-native";
import { explorerTokenUrl, MAZE_URL } from "../../../src/arc/chain.ts";
import { BadgeArt } from "../../../src/ui/BadgeArt.tsx";
import { Button } from "../../../src/ui/Button.tsx";
import { Note } from "../../../src/ui/Note.tsx";
import { Screen } from "../../../src/ui/Screen.tsx";
import { Surface } from "../../../src/ui/Surface.tsx";
import { useSession } from "../../../src/ui/session-context.tsx";
import { useTheme } from "../../../src/ui/theme-context.tsx";
import { tokens } from "../../../src/ui/tokens.ts";
import { useBadges } from "../../../src/ui/useBadges.ts";

/**
 * What the agents earned: the badges this wallet holds.
 *
 * The only screen in the app about something *earned* rather than granted, spent or read. A badge is
 * minted by the maze to whoever owns the agent's ERC-8004 identity, one per holder, and nothing on
 * this phone can bring one about — which is exactly why it is worth showing.
 *
 * The picture is the badge's own, fetched from the address the token names, so what is on the phone
 * is what a block explorer or any other wallet draws.
 */
export default function RewardsScreen() {
  const { wallet } = useSession();
  const c = useTheme().color;
  const { badges, loading, error, refresh } = useBadges(wallet.account?.address ?? null);

  // A badge can arrive while the app is away, and nothing here polls: it is minted once and never
  // changes, so asking again on the way back is enough.
  useEffect(() => {
    const watch = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => watch.remove();
  }, [refresh]);

  if (wallet.account === null) {
    return (
      <Screen>
        <Surface>
          <Text style={[styles.title, { color: c.paper }]}>No wallet yet</Text>
          <Text style={[styles.body, { color: c.dim }]}>
            Badges are given to a wallet. Create one on the Allowances tab, and what your agents earn
            arrives here.
          </Text>
        </Surface>
      </Screen>
    );
  }

  return (
    <Screen>
      {error !== null && <Note tone="warn">{error}</Note>}

      {badges.map((badge) => (
        <Surface key={badge.number} style={styles.badge}>
          <BadgeArt svg={badge.svg} number={badge.number} />
          <Text style={[styles.title, { color: c.paper }]}>{badge.name}</Text>
          <Text style={[styles.body, { color: c.dim }]}>
            Earned by an agent of yours, and given to this wallet. One badge per holder, so nobody can
            collect them.
          </Text>
          <View style={styles.links}>
            <Button compact icon="open-outline" title="How it was earned" onPress={() => void Linking.openURL(badge.uri)} />
            <Button
              compact
              icon="open-outline"
              title="Check on ArcScan"
              onPress={() => void Linking.openURL(explorerTokenUrl(badge.number))}
            />
          </View>
        </Surface>
      ))}

      {badges.length === 0 && !loading && error === null && (
        <Surface>
          <Text style={[styles.title, { color: c.paper }]}>Nothing earned yet</Text>
          <Text style={[styles.body, { color: c.dim }]}>
            A badge is minted when an agent of yours solves the maze, and it is given to the wallet
            that owns that agent's identity. There are a hundred places in Cohort Zero.
          </Text>
          <Button icon="open-outline" title="See the maze" onPress={() => void Linking.openURL(MAZE_URL)} />
        </Surface>
      )}

      {loading && <ActivityIndicator color={c.dim} accessibilityLabel="Reading your badges from Arc" />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", gap: tokens.space.md },
  title: { ...tokens.type.headline, textAlign: "center" },
  body: { ...tokens.type.subheadline, textAlign: "center" },
  links: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap", justifyContent: "center" },
});
