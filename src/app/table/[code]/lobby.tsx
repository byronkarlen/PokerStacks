import { api } from "@/convex/_generated/api";
import { DealerButton } from "@/components/table/DealerButton";
import { OvalFelt } from "@/components/table/OvalFelt";
import { PotCard } from "@/components/table/PotCard";
import { SeatPill } from "@/components/table/SeatPill";
import { seatPosition } from "@/components/table/geometry";
import { useMe } from "@/hooks/useMe";
import { colors, typography } from "@/theme";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Pre-game lobby. Players see the table code, watch others join, anyone
// presses "Start" once at least 2 are seated. Auto-redirects to /hand when
// the game starts, or back home if the host cancels.
export default function Lobby() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = codeParam.toUpperCase();
  const me = useMe();
  const userId = me?._id;

  const table = useQuery(api.games.getByCode, { code });
  const seats = useQuery(
    api.games.getSeatsWithProfile,
    table ? { gameId: table._id } : "skip",
  );

  const startGame = useMutation(api.games.startGame);
  const endGame = useMutation(api.games.endGame);
  const leaveTable = useMutation(api.games.leaveGame);

  // Drive route changes from the table's lifecycle so all clients react
  // simultaneously when the host starts/cancels.
  useEffect(() => {
    if (table?.status === "active") {
      router.replace(`/table/${code}/hand`);
    } else if (table?.status === "ended") {
      if (router.canGoBack()) router.back();
      else router.replace("/");
    }
  }, [table?.status, code, router]);

  const [startError, setStartError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [leaving, setLeaving] = useState(false);

  if (!table || !seats) {
    return (
      <SafeAreaView style={[styles.container, styles.loading]}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  const isHost = !!userId && table.hostUserId === userId;
  const readyCount = seats.filter((s) => s.status === "active").length;
  const canStart = readyCount >= 2;
  const buyInBigBlinds = table.defaultBuyIn / table.bigBlind;
  const totalChipsOnTable = seats.reduce((sum, s) => sum + s.chipStack, 0);
  const totalChipsInBigBlinds = totalChipsOnTable / table.bigBlind;

  // Where the local user sits — pinned to the bottom of the oval; everyone
  // else rotates around. Falls back to seat 0 if the user isn't seated.
  const meIndex = Math.max(
    0,
    seats.findIndex((s) => s.userId === userId),
  );

  // Backend stores -1 until the first hand deals; hands.ts interprets that
  // as seat 0 (the host), so display the dealer button on that same seat.
  const dealerSeatIndex =
    table.dealerSeatIndex < 0 ? 0 : table.dealerSeatIndex;

  async function handleStart() {
    if (!userId || !table) return;
    setStartError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await startGame({ gameId: table._id });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start");
    }
  }

  async function handleCancel() {
    if (!userId || !table || canceling) return;
    setCanceling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await endGame({ gameId: table._id });
    } catch {
      setCanceling(false);
    }
  }

  async function handleLeave() {
    if (!userId || !table || leaving) return;
    setLeaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await leaveTable({ gameId: table._id });
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch {
      setLeaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.kicker}>Share code</Text>
          <Text style={styles.code}>{table.code}</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.kicker}>Buy-in</Text>
          <Text style={styles.stakes}>{buyInBigBlinds} BB</Text>
        </View>
      </View>

      <View style={styles.tableWrap}>
        <OvalFelt>
          <View style={styles.potCenter}>
            <PotCard>Total: {totalChipsInBigBlinds}</PotCard>
          </View>
          {seats.map((seat, i) => (
            <SeatPill
              key={seat._id}
              seat={seat}
              isHostSeat={seat.userId === table.hostUserId}
              bigBlind={table.bigBlind}
              position={seatPosition(i, seats.length, meIndex)}
            />
          ))}
          <DealerButton
            seats={seats}
            meIndex={meIndex}
            dealerSeatIndex={dealerSeatIndex}
            handId={undefined}
          />
        </OvalFelt>
      </View>

      <View style={styles.footer}>
        {startError ? <Text style={styles.error}>{startError}</Text> : null}
        <Pressable
          onPress={handleStart}
          disabled={!canStart}
          style={[styles.cta, !canStart && styles.ctaDisabled]}
        >
          <Text style={styles.ctaText}>Start game</Text>
        </Pressable>
        {isHost ? (
          <Pressable
            onPress={handleCancel}
            disabled={canceling}
            style={styles.cancel}
            hitSlop={8}
          >
            <Text style={styles.cancelText}>
              {canceling ? "Canceling…" : "Cancel"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleLeave}
            disabled={leaving}
            style={styles.cancel}
            hitSlop={8}
          >
            <Text style={styles.cancelText}>
              {leaving ? "Leaving…" : "Leave"}
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "flex-end" },
  kicker: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.4,
    color: colors.gold,
    textTransform: "uppercase",
  },
  code: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 48,
    color: colors.gold,
    marginTop: 4,
  },
  stakes: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 22,
    color: colors.ivory,
    marginTop: 2,
  },

  tableWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // PotCard sits at the felt center — small offset above geometric center so
  // it lines up visually with the felt's optical center.
  potCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 220 - 11,
    alignItems: "center",
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  cta: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  cancel: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  cancelText: {
    color: "#c99895",
    fontSize: 13,
    fontWeight: "600",
  },
  error: {
    color: colors.danger,
    marginBottom: 8,
    textAlign: "center",
    fontSize: 13,
  },
});
