import { type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A pane of glass.
 *
 * Three things together make it read as glass rather than a lighter rectangle: a translucent fill,
 * a **brighter top edge** where light lands, and a shadow putting it above the ground. Any one
 * alone looks like a flat box with an effect applied.
 *
 * The colours come from the active theme, so a palette change moves every surface at once and no
 * component has to know which theme it is in.
 */
export function Surface({
  children, raised = false, style,
}: {
  readonly children: ReactNode;
  readonly raised?: boolean;
  readonly style?: ViewStyle;
}) {
  const c = useTheme().color;
  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: c.glass,
          borderColor: c.hairline,
          // The lit edge. A uniform border reads as an outlined rectangle; one brighter side reads
          // as a surface catching light.
          borderTopColor: c.specular,
        },
        raised && styles.raised,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.base,
    gap: tokens.space.sm,
    ...tokens.shadow.panel,
  },
  raised: { ...tokens.shadow.panel, shadowOpacity: 0.45 },
});
