import { colors } from "@/theme";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ComponentProps } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import { BET_ANCHOR_W, BET_CHIP_H } from "./geometry";

// A bet/blind chip resting on the felt rail next to a seat — a small dark
// pill showing a gold poker-chip icon and the amount in chips.
//
// On mount the chip pops in (scale 0 → 1, springy). The caller controls when
// "mount" happens via the `key` prop on the rendered element, so the pop
// fires for every fresh chip: blinds at the start of a hand, the first chip
// a player puts in on a new street, etc.
//
// `enteringDelayMs` lets the caller stagger pop-ins (e.g. SB waits for the
// dealer button to finish sliding, then BB waits for SB).
export const BET_CHIP_POP_MS = 280;

export function BetChip({
  amount,
  position,
  enteringDelayMs = 0,
}: {
  amount: number;
  position: { left: number; top: number };
  enteringDelayMs?: number;
}) {
  const entering: ComponentProps<typeof Animated.View>["entering"] =
    enteringDelayMs > 0
      ? ZoomIn.delay(enteringDelayMs).duration(BET_CHIP_POP_MS).springify()
      : ZoomIn.duration(BET_CHIP_POP_MS).springify();

  return (
    <Animated.View
      entering={entering}
      style={[styles.anchor, position]}
      pointerEvents="none"
    >
      <Animated.View style={styles.chip}>
        <MaterialCommunityIcons
          name="poker-chip"
          size={11}
          color={colors.gold}
        />
        <Text style={styles.amount}>{amount}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Fixed-width centering frame. The chip itself shrink-wraps inside, so "1"
  // and "999" both look tight while still being centered on the rail.
  anchor: {
    position: "absolute",
    width: BET_ANCHOR_W,
    height: BET_CHIP_H,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(11,20,16,0.92)",
    borderWidth: 1,
    borderColor: colors.hairStrong,
  },
  amount: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.2,
  },
});
