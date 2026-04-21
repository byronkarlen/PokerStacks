import { api } from "@/convex/_generated/api";
import { useUserId } from "@/hooks/useUserId";
import { colorHex, colors } from "@/theme";
import { useMutation, useQuery } from "convex/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Settle() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const userId = useUserId();

  const table = useQuery(api.tables.getByCode, { code });
  const settlement = useQuery(
    api.tables.getSettlement,
    table ? { tableId: table._id } : "skip",
  );
  const deleteTable = useMutation(api.tables.deleteTable);
  const [finishing, setFinishing] = useState(false);

  if (!table || !settlement) {
    return (
      <SafeAreaView style={[styles.container, styles.loading]}>
        <Stack.Screen options={{ headerShown: true, title: "Settlement" }} />
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  const { rows, transfers, sumNetMismatch } = settlement;

  function handleShare() {
    const lines: string[] = [];
    lines.push(`PokerStacks · ${table!.code}`);
    lines.push("");
    lines.push("Final");
    for (const r of rows) {
      const sign = r.net > 0 ? "+" : "";
      lines.push(`  ${r.displayName}: ${sign}${r.net} chips`);
    }
    if (transfers.length > 0) {
      lines.push("");
      lines.push("Pay");
      for (const t of transfers) {
        lines.push(`  ${t.fromName} → ${t.toName}: ${t.amount} chips`);
      }
    }
    Share.share({ message: lines.join("\n") }).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: "Settlement" }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.code}>{table.code}</Text>
          <Text style={styles.title}>Game over</Text>
        </View>

        <Text style={styles.sectionLabel}>Net per player</Text>
        {rows.map((row) => (
          <View key={row.seatId} style={styles.row}>
            <View
              style={[styles.colorDot, { backgroundColor: colorHex(row.color) }]}
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.name}>{row.displayName}</Text>
              <Text style={styles.muted}>
                {row.buyIns} in · {row.cashOuts} out
              </Text>
            </View>
            <Text
              style={[
                styles.net,
                {
                  color:
                    row.net > 0
                      ? colors.gold
                      : row.net < 0
                      ? colors.danger
                      : colors.mute,
                },
              ]}
            >
              {row.net > 0 ? `+${row.net}` : row.net}
            </Text>
          </View>
        ))}

        {sumNetMismatch !== 0 ? (
          <Text style={styles.warning}>
            Heads up — nets don&apos;t sum to zero ({sumNetMismatch}). Check the
            history for stack edits or undone events.
          </Text>
        ) : null}

        <Text style={[styles.sectionLabel, { marginTop: 32 }]}>
          Pay this out
        </Text>
        {transfers.length === 0 ? (
          <Text style={styles.muted}>Nothing to settle — everyone is even.</Text>
        ) : (
          transfers.map((t, i) => (
            <View key={i} style={styles.transferRow}>
              <Text style={styles.transferText}>
                <Text style={styles.transferName}>{t.fromName}</Text>
                <Text style={styles.muted}>  pays  </Text>
                <Text style={styles.transferName}>{t.toName}</Text>
              </Text>
              <Text style={styles.transferAmount}>{t.amount}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={handleShare} style={styles.cta}>
          <Text style={styles.ctaText}>Share summary</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            if (finishing) return;
            setFinishing(true);
            const isHost =
              !!userId && !!table && table.hostUserId === userId;
            if (isHost && table) {
              // Host finalizes the game — wipe every row referencing this
              // table so the DB stays clean. Non-hosts just navigate away; the
              // host's delete will retroactively clear it from their queries too.
              try {
                await deleteTable({ userId: userId!, tableId: table._id });
              } catch {
                // If delete fails, we still want the user home — they can
                // tap Done again to retry.
              }
            }
            router.replace("/");
          }}
          disabled={finishing}
          style={[
            styles.cta,
            styles.ctaSecondary,
            finishing && { opacity: 0.4 },
          ]}
        >
          <Text style={[styles.ctaText, { color: colors.text }]}>
            {finishing ? "Finishing…" : "Done"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },
  scroll: { padding: 16, paddingBottom: 24 },
  header: { alignItems: "center", marginTop: 8, marginBottom: 24 },
  code: { color: colors.mute, fontSize: 14, letterSpacing: 4 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: 4 },
  sectionLabel: {
    color: colors.mute,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.hair,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  colorDot: { width: 24, height: 24, borderRadius: 12 },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  muted: { color: colors.mute, fontSize: 13, marginTop: 2 },
  net: {
    fontSize: 24,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  warning: {
    color: colors.gold,
    backgroundColor: colors.surface,
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    fontSize: 13,
  },
  transferRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderColor: colors.hair,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  transferText: { color: colors.text, fontSize: 16 },
  transferName: { color: colors.text, fontWeight: "700" },
  transferAmount: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  footer: {
    padding: 16,
    paddingTop: 12,
    borderTopColor: colors.hair,
    borderTopWidth: 1,
    gap: 8,
  },
  cta: {
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.hair,
    borderWidth: 1,
  },
  ctaText: { color: colors.bg, fontSize: 17, fontWeight: "700" },
});
