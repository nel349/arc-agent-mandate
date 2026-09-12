import { StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { cohortBadgeName } from "./badge-metadata.ts";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A badge, drawn from the picture the badge itself carries.
 *
 * The same markup a block explorer or any wallet would draw, since it comes from the token's own
 * metadata rather than from a copy kept here. Nothing about it is ours to restyle: a badge that
 * looked different on the phone from on the chain would be a badge nobody could check.
 *
 * Presentational. When there is no picture — an old phone, a fetch that failed — it draws the number
 * on a plate instead, because the number is what was earned and it must still be there.
 */
export function BadgeArt({
  svg, number, size = tokens.size.ring.hero,
}: {
  readonly svg: string | null;
  readonly number: number;
  readonly size?: number;
}) {
  const c = useTheme().color;
  const label = cohortBadgeName(number);

  if (svg === null) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={[styles.plate, { width: size, height: size, borderColor: c.hairline, backgroundColor: c.glass }]}
      >
        <Text style={[styles.number, { color: c.paper }]}>#{number}</Text>
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={label} style={[styles.frame, { width: size, height: size }]}>
      <SvgXml xml={svg} width="100%" height="100%" />
    </View>
  );
}

const styles = StyleSheet.create({
  /** Clipped, because the badge's own art fills its box to the edges. */
  frame: { borderRadius: tokens.radius.lg, overflow: "hidden" },
  plate: {
    borderRadius: tokens.radius.lg,
    borderWidth: tokens.border.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  number: { ...tokens.type.hero, fontVariant: [...tokens.font.tabular] },
});
