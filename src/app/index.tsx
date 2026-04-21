import { api } from "@/convex/_generated/api";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useUserId } from "@/hooks/useUserId";
import { colors, typography } from "@/theme";
import { useConvex, useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Index() {
  const router = useRouter();
  const userId = useUserId();
  const displayName = useDisplayName();
  const createTable = useMutation(api.tables.createTable);
  const convex = useConvex();
  const [creatingTable, setCreatingTable] = useState(false);
  const [checkingForActiveTable, setCheckingForActiveTable] = useState(true);

  // Uses convex.query rather than useQuery so we don't stay subscribed
  useEffect(() => {
    if (!userId) {
      setCheckingForActiveTable(false);
      return;
    }
    let cancelled = false;
    convex.query(api.tables.getMyActiveTable, { userId }).then((result) => {
      if (cancelled) return;
      if (result?.table.status === "lobby") {
        router.replace(`/table/${result.table.code}/lobby`);
      } else if (result?.table.status === "active") {
        router.replace(`/table/${result.table.code}/hand`);
      } else {
        setCheckingForActiveTable(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, router, convex]);

  // Loading state: user, profile, or active-table check still pending.
  if (userId === undefined || displayName === undefined || checkingForActiveTable) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  async function handleStartGame() {
    if (creatingTable) return;
    if (!userId || !displayName) {
      router.push({ pathname: "/onboarding", params: { next: "create" } });
      return;
    }
    setCreatingTable(true);
    try {
      const { code } = await createTable({ userId });
      // Push (not replace) so home stays below lobby in the stack — lets
      // Cancel pop back with the correct left-to-right animation.
      router.push(`/table/${code}/lobby`);
    } finally {
      setCreatingTable(false);
    }
  }

  function handleJoinGame() {
    if (userId && displayName) router.push("/join");
    else router.push({ pathname: "/onboarding", params: { next: "/join" } });
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {displayName ? (
        <>
          <View style={styles.greetBlock}>
            <Text style={styles.greetLine}>Good evening,</Text>
            <Pressable
              onPress={() => router.push("/onboarding")}
              hitSlop={12}
            >
              <Text style={[styles.greetLine, styles.greetName]}>
                {displayName}.
              </Text>
            </Pressable>
            <Text style={styles.greetSub}>
              Ready to deal? Start a table or join one with a code.
            </Text>
          </View>
          <View style={{ flex: 1 }} />
        </>
      ) : (
        <>
          <View style={{ flex: 1 }} />
          <View style={styles.markBlock}>
            <Text style={styles.markPoker}>Poker</Text>
            <Text style={styles.markStacks}>STACKS</Text>
            <Text style={styles.markSub}>
              Home poker, digitized tastefully.
            </Text>
          </View>
          <View style={{ flex: 1 }} />
        </>
      )}

      <View style={styles.ctaBlock}>
        <Pressable
          onPress={handleStartGame}
          disabled={creatingTable}
          style={[styles.ctaPrimary, creatingTable && { opacity: 0.6 }]}
        >
          <Text style={styles.ctaPrimaryText}>
            {creatingTable ? "Starting…" : "Start a game"}
          </Text>
        </Pressable>
        <Pressable onPress={handleJoinGame} style={styles.ctaSecondary}>
          <Text style={styles.ctaSecondaryText}>Join with a code</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  greetBlock: {
    paddingHorizontal: 24,
    paddingTop: 64,
  },
  greetLine: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 44,
    lineHeight: 46,
    color: colors.ivory,
    letterSpacing: -0.5,
  },
  greetName: {
    color: colors.gold,
  },
  greetSub: {
    color: colors.mute,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
    maxWidth: 260,
  },
  markBlock: {
    paddingHorizontal: 32,
    alignItems: "flex-start",
  },
  markPoker: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 64,
    lineHeight: 64,
    color: colors.gold,
    letterSpacing: -1,
  },
  markStacks: {
    fontSize: 40,
    fontWeight: "800",
    color: colors.ivory,
    letterSpacing: -1.5,
    lineHeight: 40,
    marginTop: -4,
  },
  markSub: {
    marginTop: 18,
    fontSize: 14,
    lineHeight: 20,
    color: colors.mute,
    maxWidth: 280,
  },
  ctaBlock: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  ctaPrimary: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaPrimaryText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  ctaSecondary: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairStrong,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaSecondaryText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
});
