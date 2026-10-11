import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet } from "react-native";
import { BEAT_MS } from "./motion.ts";
import { tokens } from "./tokens.ts";
import { useReducedMotion } from "./useReducedMotion.ts";

/** The halo starts a little inside the ring and leaves it. */
const FROM = { scale: 0.9, opacity: 0.55 } as const;
const GONE = 0;
/**
 * How far past the ring the halo travels before it is gone, the same for a ring of any size. As a
 * share of the ring it reached a third of a screen from the largest one, through the words round it.
 * Anything drawn round a ring keeps this much clear.
 */
export const HALO_REACH = 12;
const STROKE = 2;

/**
 * One beat: a halo that leaves the ring when a payment lands.
 *
 * Laid over the ring it belongs to, the same size, and it takes no touches. It runs when `count`
 * goes up and at no other time: not when the screen first appears, which would be a beat for a
 * payment nobody made, and not when the count goes down, which is the example starting again.
 *
 * Nothing is drawn for someone who has asked for less motion.
 */
export const Beat = memo(function Beat({ count, size, color }: {
  /** Goes up by one for each payment. */
  readonly count: number;
  readonly size: number;
  readonly color: string;
}) {
  const reduced = useReducedMotion();
  // Made once, with what is read from it: made in the body, each redraw built another and threw it away.
  const [halo] = useState(() => {
    const travelled = new Animated.Value(1);
    return {
      travelled,
      opacity: travelled.interpolate({ inputRange: [0, 1], outputRange: [FROM.opacity, GONE] }),
    };
  });
  // Rebuilt only when the ring's size changes, which for a ring on screen is never.
  const scale = useMemo(
    () => halo.travelled.interpolate({ inputRange: [0, 1], outputRange: [FROM.scale, (size + HALO_REACH * 2) / size] }),
    [halo, size],
  );
  const last = useRef(count);

  useEffect(() => {
    const rose = count > last.current;
    last.current = count;
    if (!rose || reduced) return;
    halo.travelled.setValue(0);
    const beat = Animated.timing(halo.travelled, {
      toValue: 1, duration: BEAT_MS, easing: Easing.out(Easing.cubic),
      // The web has no native driver; asking for one there only logs a warning on every beat.
      useNativeDriver: Platform.OS !== "web",
    });
    beat.start();
    return () => beat.stop();
  }, [count, reduced, halo]);

  if (reduced) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.halo,
        {
          width: size, height: size, borderColor: color,
          opacity: halo.opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
});

const styles = StyleSheet.create({
  halo: { position: "absolute", borderRadius: tokens.radius.pill, borderWidth: STROKE },
});
