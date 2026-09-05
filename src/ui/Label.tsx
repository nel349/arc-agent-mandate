import { StyleSheet, Text } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A section heading.
 *
 * Small, uppercase, letterspaced — the same in every theme, because typography is structure. Only
 * the colour comes from the palette.
 *
 * `dim` is for a heading that names something already obvious from what sits under it; the default
 * is for one carrying information of its own.
 */
export function Label({ children, dim = false }: { readonly children: string; readonly dim?: boolean }) {
  const c = useTheme().color;
  return <Text style={[styles.label, { color: dim ? c.dim : c.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({ label: tokens.type.label });
