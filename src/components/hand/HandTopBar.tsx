import { Doc } from "@/convex/_generated/dataModel";
import { colors } from "@/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

// Top of the hand screen: hand number and street label on the left, table
// stakes/code under it; "Undo" + "End" buttons on the right (host only).
export function HandTopBar({
  table,
  handNumber,
  streetText,
  isHost,
  canUndo,
  onUndo,
  onEndGame,
}: {
  table: Doc<"games">;
  handNumber: number | undefined;
  streetText: string;
  isHost: boolean;
  canUndo: boolean;
  onUndo: () => void;
  onEndGame: () => void;
}) {
  return (
    <View style={styles.bar}>
      <View>
        <Text style={styles.kicker}>
          {handNumber ? `Hand ${handNumber} · ` : ""}
          {streetText}
        </Text>
        <Text style={styles.sub}>
          {table.smallBlind}/{table.bigBlind} · {table.code}
        </Text>
      </View>
      {isHost ? (
        <View style={styles.actions}>
          <Pressable
            onPress={onUndo}
            hitSlop={8}
            disabled={!canUndo}
          >
            <Text style={[styles.undoBtn, !canUndo && styles.undoBtnDisabled]}>
              Undo
            </Text>
          </Pressable>
          <Pressable onPress={onEndGame} hitSlop={8}>
            <Text style={styles.endBtn}>End</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  kicker: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  sub: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 2,
  },
  endBtn: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingVertical: 4,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  undoBtn: {
    color: colors.mute,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingVertical: 4,
  },
  undoBtnDisabled: {
    opacity: 0.35,
  },
});
