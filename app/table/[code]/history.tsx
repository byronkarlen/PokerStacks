import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { colorHex, theme } from "@/lib/colors";
import { useQuery } from "convex/react";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type SeatWithProfile = Doc<"seats"> & { displayName: string; color: string };

export default function History() {
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();

  const table = useQuery(api.tables.getByCode, { code });
  const seats = useQuery(
    api.tables.getSeatsWithProfile,
    table ? { tableId: table._id } : "skip",
  );
  const history = useQuery(
    api.hands.getHandHistory,
    table ? { tableId: table._id } : "skip",
  );

  if (!table || !seats || !history) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: "History" }} />
        <Text style={[styles.muted, { padding: 24 }]}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (history.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: "History" }} />
        <Text style={[styles.muted, { padding: 24 }]}>
          No hands played yet.
        </Text>
      </SafeAreaView>
    );
  }

  const seatMap = new Map(seats.map((s) => [s._id, s]));

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: "History" }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {history.map(({ hand, actions, result }) => (
          <HandCard
            key={hand._id}
            hand={hand}
            actions={actions}
            result={result}
            seatMap={seatMap}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function HandCard({
  hand,
  actions,
  result,
  seatMap,
}: {
  hand: Doc<"hands">;
  actions: Doc<"actions">[];
  result: Doc<"handResults"> | null;
  seatMap: Map<Id<"seats">, SeatWithProfile>;
}) {
  const [open, setOpen] = useState(false);

  const sortedActions = [...actions].sort((a, b) => a.sequence - b.sequence);

  const winnersLabel = (() => {
    if (hand.voided) return "Voided";
    if (!result || result.voided) return "—";
    return result.awards
      .map((a) => {
        const seat = seatMap.get(a.seatId);
        return `${seat?.displayName ?? "?"} +${a.amount}`;
      })
      .join("  ·  ");
  })();

  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            Hand #{hand.handNumber}
            {hand.voided ? "  (voided)" : ""}
          </Text>
          <Text style={styles.muted}>
            Pot {hand.pot}  ·  {winnersLabel}
          </Text>
        </View>
        <Text style={styles.expand}>{open ? "▾" : "▸"}</Text>
      </Pressable>

      {open ? (
        <View style={styles.cardBody}>
          {sortedActions.map((a) => {
            const seat = seatMap.get(a.seatId);
            return (
              <View
                key={a._id}
                style={[styles.actionRow, a.undone && styles.actionRowUndone]}
              >
                <View
                  style={[
                    styles.colorDot,
                    { backgroundColor: colorHex(seat?.color ?? "blue") },
                  ]}
                />
                <Text style={styles.actionLine}>
                  <Text style={styles.actionName}>
                    {seat?.displayName ?? "?"}
                  </Text>
                  <Text style={styles.muted}>
                    {"  · " + a.street + "  ·  "}
                  </Text>
                  <Text style={styles.actionType}>{a.type}</Text>
                  {a.amount > 0 ? (
                    <Text style={styles.muted}>{` ${a.amount}`}</Text>
                  ) : null}
                  {a.undone ? (
                    <Text style={[styles.muted, { color: theme.warning }]}>
                      {"  (undone)"}
                    </Text>
                  ) : null}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 16, paddingBottom: 24 },
  muted: { color: theme.textMuted, fontSize: 13 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  expand: { color: theme.textMuted, fontSize: 18, marginLeft: 8 },
  cardBody: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    padding: 12,
    gap: 6,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  actionRowUndone: { opacity: 0.5 },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  actionLine: { color: theme.text, fontSize: 13, flex: 1 },
  actionName: { color: theme.text, fontWeight: "600" },
  actionType: { color: theme.text, fontWeight: "600", textTransform: "uppercase" },
});
