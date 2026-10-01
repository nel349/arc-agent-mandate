import { Linking, StyleSheet, Text, View } from "react-native";
import { BENCH_URL, explorerTokenUrl, MAZE_URL } from "../../../src/arc/chain.ts";
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
 * What the agents earned: the badges this wallet holds, and where the rest of it is kept.
 *
 * The only screen in the app about something *earned* rather than granted, spent or read. Agents
 * earn two kinds of thing. A badge is minted by the maze to whoever owns the agent's ERC-8004
 * identity, one per holder, and is shown here. Reputation is written to the identity itself, by
 * Bench when it ranks a run, and is shown on that agent's own page, because it belongs to the agent
 * rather than to the wallet. This screen used to speak only of the maze, so somebody whose agent
 * trained on Bench was told they had earned nothing and sent somewhere else.
 *
 * The picture is the badge's own, fetched from the address the token names, so what is on the phone
 * is what a block explorer or any other wallet draws.
 */
export default function RewardsScreen() {
  const { wallet } = useSession();
  const c = useTheme().color;
  const { badges, loading, error, refresh } = useBadges(wallet.account?.address ?? null);

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
    // Nothing here polls, by design: a badge is minted once and never changes. That leaves the pull
    // as the only way to ask again without leaving the app -- and a badge minted while this tab was
    // open is exactly how one stayed invisible on a phone that already held it.
    <Screen onRefresh={refresh} refreshing={loading}>
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

      {!loading && error === null && (
        <Surface>
          {badges.length === 0 && <Text style={[styles.title, { color: c.paper }]}>No badges yet</Text>}
          <Text style={[styles.body, { color: c.dim }]}>
            Your agents earn two kinds of reward. Reputation is written to an agent's ERC-8004
            identity each time Bench ranks one of its runs, and shows on that agent's page under
            Allowances. A badge is given to this wallet when an agent of yours solves the maze, and
            shows here.
          </Text>
          <View style={styles.links}>
            <Button compact icon="open-outline" title="See Bench" onPress={() => void Linking.openURL(BENCH_URL)} />
            <Button compact icon="open-outline" title="See the maze" onPress={() => void Linking.openURL(MAZE_URL)} />
          </View>
        </Surface>
      )}

    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", gap: tokens.space.md },
  title: { ...tokens.type.headline, textAlign: "center" },
  body: { ...tokens.type.subheadline, textAlign: "center" },
  links: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap", justifyContent: "center" },
});
