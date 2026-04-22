import { api } from "@/convex/_generated/api";
import { colorHex, colors, typography } from "@/theme";
import { useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const PILL_H = 48;

export default function Settle() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();

  const table = useQuery(api.games.getByCode, { code });
  const settlement = useQuery(
    api.games.getSettlement,
    table ? { gameId: table._id } : "skip",
  );

  if (!table || !settlement) {
    return (
      <SafeAreaView style={[styles.container, styles.loading]}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  const { rows } = settlement;

  function handleDone() {
    router.replace("/");
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Results</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>Final chips</Text>
        {rows.map((row) => (
          <View key={row.seatId} style={styles.row}>
            <View
              style={[styles.avatar, { backgroundColor: colorHex(row.color) }]}
            >
              <Text style={styles.avatarText}>
                {row.displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {row.displayName}
            </Text>
            <Text style={styles.chips}>{row.chipStack}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={handleDone} style={styles.cta}>
          <Text style={styles.ctaText}>Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },

  header: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 8,
  },
  code: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.4,
    color: colors.gold,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 44,
    lineHeight: 46,
    color: colors.ivory,
    letterSpacing: -0.5,
    marginTop: 6,
  },

  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.4,
    color: colors.gold,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  // Matches the seat-pill visual language: same height, same borderRadius,
  // same dark background, same avatar chip.
  row: {
    height: PILL_H,
    borderRadius: 12,
    backgroundColor: "#14231b",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.18)",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 4,
    paddingRight: 18,
    gap: 10,
    marginBottom: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  avatarText: {
    color: "rgba(0,0,0,0.75)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  name: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  chips: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 20,
    color: colors.gold,
    fontVariant: ["tabular-nums"],
  },

  footer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  cta: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
