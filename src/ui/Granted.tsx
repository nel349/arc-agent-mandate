import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ArcRing } from "./ArcRing.tsx";
import { Beat } from "./Beat.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * The moment an allowance is granted: a whole ring, all of it left, and one beat.
 *
 * It is the one thing on that screen that is new. The card above it is the card the person has just
 * read and confirmed; without this the screen that follows a passkey looked like the one before it
 * with a different sentence.
 */
export function Granted() {
  const c = useTheme().color;
  // Raised once the ring is on screen: a beat is for something that has just happened, and `Beat`
  // does not run for a count it was first drawn with.
  const [beats, setBeats] = useState(0);
  useEffect(() => { setBeats(1); }, []);
  return (
    <View style={styles.granted}>
      <Beat count={beats} size={tokens.size.ring.review} color={c.untested} />
      <ArcRing spent={0} size={tokens.size.ring.review} label="" />
    </View>
  );
}

const styles = StyleSheet.create({
  granted: { alignItems: "center", justifyContent: "center" },
});
