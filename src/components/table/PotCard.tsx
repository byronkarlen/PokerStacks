import { colors } from "@/theme";
import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BET_CHIP_H } from "./geometry";

// The "Total: N" pill shown at the centre of the felt. Same dark-pill
// language as the per-seat bet chips so chips-out and pot-in read as one
// system. Children are rendered as the pill's text content.
export function PotCard({ children }: { children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

// A dimmer, smaller pill below the main PotCard — used to show side pots
// when the hand has produced any.
export function SidePotCard({ children }: { children: ReactNode }) {
  return (
    <View style={styles.subCard}>
      <Text style={styles.subText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: BET_CHIP_H,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(11,20,16,0.92)",
    borderWidth: 1,
    borderColor: colors.hairStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  text: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  subCard: {
    height: BET_CHIP_H - 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "rgba(11,20,16,0.85)",
    borderWidth: 1,
    borderColor: colors.hair,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  subText: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: -0.1,
    fontVariant: ["tabular-nums"],
  },
});
