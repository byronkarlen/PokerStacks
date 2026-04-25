import { ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { TABLE_H, TABLE_W } from "./geometry";

// Fixed-size container with the felt-green oval painted in its center. Every
// piece of the table (seats, dealer button, bet chips, pot card, community
// cards) is rendered as an absolutely-positioned child of this view in the
// `tableArea` coordinate space.
//
// We use Animated.View with `LinearTransition` so that layout-impacting
// children animate smoothly — that's mostly a no-op today but keeps the door
// open for future "seats reshuffle around the table" effects.
export function OvalFelt({ children }: { children: ReactNode }) {
  return (
    <Animated.View style={styles.tableArea} layout={LinearTransition}>
      <Animated.View style={styles.oval} />
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tableArea: {
    width: TABLE_W,
    height: TABLE_H,
  },
  // The felt oval is narrower than TABLE_W so seat pills overhang the rail
  // slightly — gives the table a 3D-ish visual depth.
  oval: {
    position: "absolute",
    left: (TABLE_W - 210) / 2,
    top: (TABLE_H - 360) / 2,
    width: 210,
    height: 360,
    borderRadius: 160,
    backgroundColor: "#153023",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.08)",
  },
});
