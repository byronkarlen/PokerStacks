import { api } from "@/convex/_generated/api";
import { colorHex, theme } from "@/lib/colors";
import { useQuery } from "convex/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
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

  const table = useQuery(api.tables.getByCode, { code });
  const settlement = useQuery(
    api.tables.getSettlement,
    table ? { tableId: table._id } : "skip",
  );

  if (!table || !settlement) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: "Settlement" }} />
        <Text style={[styles.muted, { padding: 24 }]}>Loading…</Text>
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
                      ? theme.accent
                      : row.net < 0
                      ? theme.danger
                      : theme.textMuted,
                },
              ]}
            >
              {row.net > 0 ? `+${row.net}` : row.net}
            </Text>
          </View>
        ))}

        {sumNetMismatch !== 0 ? (
          <Text style={styles.warning}>
            Heads up — nets don't sum to zero ({sumNetMismatch}). Check the
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
          onPress={() => router.replace("/")}
          style={[styles.cta, styles.ctaSecondary]}
        >
          <Text style={[styles.ctaText, { color: theme.text }]}>Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 16, paddingBottom: 24 },
  header: { alignItems: "center", marginTop: 8, marginBottom: 24 },
  code: { color: theme.textMuted, fontSize: 14, letterSpacing: 4 },
  title: { color: theme.text, fontSize: 28, fontWeight: "800", marginTop: 4 },
  sectionLabel: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  colorDot: { width: 24, height: 24, borderRadius: 12 },
  name: { color: theme.text, fontSize: 16, fontWeight: "600" },
  muted: { color: theme.textMuted, fontSize: 13, marginTop: 2 },
  net: {
    fontSize: 24,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  warning: {
    color: theme.warning,
    backgroundColor: theme.surface,
    borderColor: theme.warning,
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
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  transferText: { color: theme.text, fontSize: 16 },
  transferName: { color: theme.text, fontWeight: "700" },
  transferAmount: {
    color: theme.text,
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  footer: {
    padding: 16,
    paddingTop: 12,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    gap: 8,
  },
  cta: {
    backgroundColor: theme.accent,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaSecondary: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
  },
  ctaText: { color: theme.bg, fontSize: 17, fontWeight: "700" },
});
