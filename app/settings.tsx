import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppearance } from "../src/ui/theme-context.tsx";
import { THEMES, type ThemeId } from "../src/ui/themes.ts";
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
        <Text style={[styles.section, { color: c.muted }]}>Appearance</Text>

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
        <Text style={[styles.section, { color: c.muted }]}>Network</Text>
        <View style={styles.plain}>
          <Text style={[styles.name, { color: c.paper }]}>Arc</Text>
          <Text style={[styles.value, { color: c.dim }]}>Testnet</Text>
        </View>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.label,
    letterSpacing: tokens.font.labelTracking,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    borderTopWidth: 1,
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
