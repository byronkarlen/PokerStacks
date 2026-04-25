import { Doc } from "@/convex/_generated/dataModel";
import { colors } from "@/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

// Top of the hand screen: hand number and street label on the left, table
// stakes/code under it; "End" button on the right (host only).
export function HandTopBar({
  table,
  handNumber,
  streetText,
  isHost,
  onEndGame,
}: {
  table: Doc<"games">;
  handNumber: number | undefined;
  streetText: string;
  isHost: boolean;
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
        <Pressable onPress={onEndGame} hitSlop={8}>
          <Text style={styles.endBtn}>End</Text>
        </Pressable>
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
});
