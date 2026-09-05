import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAppearance } from "../src/ui/theme-context.tsx";
import { THEMES, type ThemeId } from "../src/ui/themes.ts";
import { Label } from "../src/ui/Label.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { tokens } from "../src/ui/tokens.ts";

/**
 * Settings, following the Kuira wallet's shape: a list of rows, each with a label and its current
 * value, on glass.
 *
 * Appearance is expanded in place rather than pushed onto a second screen. There are two options
 * and they are the point of the row — hiding them behind a chevron would cost a navigation for
 * something a person can decide by looking.
 */
export default function SettingsScreen() {
  const { theme, setTheme } = useAppearance();
  const c = theme.color;

  const choose = useCallback((id: ThemeId) => () => setTheme(id), [setTheme]);

  return (
    <Screen>
      <Surface>
        <Label>Appearance</Label>

        {THEMES.map((option) => {
          const active = option.id === theme.id;
          return (
            <Pressable
              key={option.id}
              onPress={choose(option.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.name}. ${option.note}`}
              style={[styles.row, { borderColor: c.hairline }]}
            >
              <View style={styles.swatch}>
                <View style={[styles.chip, { backgroundColor: option.color.groundMid }]} />
                <View style={[styles.chip, { backgroundColor: option.color.paper }]} />
                <View style={[styles.chip, { backgroundColor: option.color.signal }]} />
              </View>

              <View style={styles.labels}>
                <Text style={[styles.name, { color: c.paper }]}>{option.name}</Text>
                <Text style={[styles.note, { color: c.dim }]}>{option.note}</Text>
              </View>

              {/* A filled dot rather than a tick: it echoes the live indicator, and reads at the
                  same glance distance as the swatches beside it. */}
              <View style={[styles.mark, { borderColor: active ? c.signal : c.hairline }]}>
                {active && <View style={[styles.markOn, { backgroundColor: c.signal }]} />}
              </View>
            </Pressable>
          );
        })}
      </Surface>

      <Surface>
        <Label>Network</Label>
        <View style={styles.plain}>
          <Text style={[styles.name, { color: c.paper }]}>Arc</Text>
          <Text style={[styles.value, { color: c.dim }]}>Testnet</Text>
        </View>
      </Surface>

      {/* A debug tool, not a destination. It was sitting on the main screen next to Settings as
          though the two were peers; here it is where someone goes looking for it and nowhere
          near where someone is trying to give an agent money. */}
      <Surface>
        <Label>Diagnostics</Label>
        <Link href="/dev" asChild>
          <Pressable
            style={[styles.row, { borderColor: c.hairline }]}
            accessibilityRole="link"
            accessibilityLabel="Developer harness"
            accessibilityHint="Step through the passkey ceremony and read the raw log"
          >
            <View style={styles.labels}>
              <Text style={[styles.name, { color: c.paper }]}>Developer harness</Text>
              <Text style={[styles.note, { color: c.dim }]}>
                Step through the ceremony, read the raw log
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.dim} />
          </Pressable>
        </Link>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    borderTopWidth: 1,
    // Apple's minimum comfortable target is 44pt. The content happened to add up to about that,
    // which is not the same as guaranteeing it — a shorter label would have quietly broken it.
    minHeight: tokens.size.tapTarget,
  },
  swatch: { flexDirection: "row", gap: 3 },
  chip: { width: 9, height: 22, borderRadius: 3 },
  labels: { flex: 1, gap: 2 },
  name: { fontSize: tokens.font.body, fontWeight: "600" },
  note: { fontSize: tokens.font.small },
  value: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
  mark: {
    width: 18, height: 18, borderRadius: 99, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  markOn: { width: 8, height: 8, borderRadius: 99 },
  plain: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: tokens.space.xs,
  },
});
