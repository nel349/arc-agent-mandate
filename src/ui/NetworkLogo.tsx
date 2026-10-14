import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import { accentOf } from "./network-look.ts";
import { logoOf } from "./network-logos.ts";
import { tokens } from "./tokens.ts";

/**
 * A network's own logo, round, beside its name.
 *
 * Drawn from the owner's file as published (`network-logos.ts`), at the size asked and nothing else
 * changed. Hidden from screen readers: the name beside it already says which network, and a second
 * "Arc" read out from a picture says nothing new. A network this build has no logo for is its colour,
 * as a dot the same size, so a row never loses its mark.
 */
export function NetworkLogo({ network, size }: { readonly network: NetworkProfile; readonly size: number }) {
  const logo = logoOf(network);
  if (logo === null) {
    return <View aria-hidden style={{ width: size, height: size, borderRadius: tokens.radius.pill, backgroundColor: accentOf(network) }} />;
  }
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      <SvgXml xml={logo} width={size} height={size} />
    </View>
  );
}
