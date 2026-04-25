import { Doc } from "@/convex/_generated/dataModel";
import { colorHex, colors, typography } from "@/theme";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { PILL_H, PILL_W } from "./geometry";

// A seat at the table. Used by both the lobby and the live-hand screen — the
// hand variant adds the `isToAct` (your turn) glow and the `isFolded` dim, but
// they otherwise look identical so they're one component.
export type SeatWithProfile = Doc<"seats"> & { displayName: string };

export function SeatPill({
  seat,
  isHostSeat,
  isToAct = false,
  isFolded = false,
  bigBlind,
  position,
}: {
  seat: SeatWithProfile;
  isHostSeat: boolean;
  isToAct?: boolean;
  isFolded?: boolean;
  bigBlind: number;
  position: { left: number; top: number };
}) {
  return (
    <View
      style={[
        styles.seatPill,
        position,
        isToAct && styles.seatPillToAct,
        isFolded && styles.seatPillFolded,
      ]}
    >
      {isHostSeat ? <HostCrown /> : null}
      <Avatar color={seat.color} initial={seat.displayName[0] ?? "?"} />
      <View style={styles.stackRow}>
        <Text style={styles.stack} numberOfLines={1}>
          {seat.chipStack / bigBlind}
        </Text>
      </View>
    </View>
  );
}

// Host crown — gold chip in the top-right corner of the seat pill.
function HostCrown() {
  return (
    <View style={styles.hostChip}>
      <MaterialCommunityIcons name="crown" size={9} color={colors.bg} />
    </View>
  );
}

function Avatar({ color, initial }: { color: string; initial: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: colorHex(color) }]}>
      <Text style={styles.avatarText}>{initial.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  seatPill: {
    position: "absolute",
    width: PILL_W,
    height: PILL_H,
    borderRadius: 10,
    backgroundColor: "#14231b",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.18)",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 6,
    paddingRight: 8,
    gap: 6,
  },
  // It's the local player's turn — gold border + glow.
  seatPillToAct: {
    borderColor: colors.gold,
    borderWidth: 2,
    shadowColor: colors.gold,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  // Player has folded or is busted/inactive — dim the entire pill.
  seatPillFolded: {
    opacity: 0.4,
  },
  avatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "rgba(0,0,0,0.75)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  stackRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  stack: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 13,
    color: colors.gold,
  },
  // Host crown chip — overhangs the top-right corner by 5px on both sides.
  hostChip: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gold,
    borderWidth: 1.5,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});
