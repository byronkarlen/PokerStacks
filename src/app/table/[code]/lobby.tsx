import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { useMe } from "@/hooks/useMe";
import { colorHex, colors, typography } from "@/theme";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type SeatWithProfile = Doc<"seats"> & { displayName: string };

const TABLE_W = 340;
const TABLE_H = 440;
const SEAT_RX = 125;
const SEAT_RY = 200;
const PILL_W = 78;
const PILL_H = 28;

// "me" sits at angle π/2 (bottom of oval); everyone else rotates around.
function seatPosition(index: number, total: number, meIndex: number) {
  const angle = ((index - meIndex) / total) * Math.PI * 2 + Math.PI / 2;
  const cx = TABLE_W / 2;
  const cy = TABLE_H / 2;
  return {
    left: cx + SEAT_RX * Math.cos(angle) - PILL_W / 2,
    top: cy + SEAT_RY * Math.sin(angle) - PILL_H / 2,
  };
}

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

  useEffect(() => {
    if (table?.status === "active") {
      router.replace(`/table/${code}/hand`);
    } else if (table?.status === "ended") {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/");
      }
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
  const canStart = isHost && readyCount >= 2;
  const buyInBB = table.defaultBuyIn / table.bigBlind;
  const totalChips = seats.reduce((sum, s) => sum + s.chipStack, 0);
  const totalBB = totalChips / table.bigBlind;
  const meIndex = Math.max(
    0,
    seats.findIndex((s) => s.userId === userId),
  );
  // Backend stores -1 until the first hand deals; hands.ts interprets that as
  // seat 0 (the host), so display that same seat with the dealer button.
  const effectiveDealerIdx =
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
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/");
      }
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
          <Text style={styles.stakes}>{buyInBB} BB</Text>
        </View>
      </View>

      <View style={styles.tableWrap}>
        <View style={styles.tableArea}>
          <View style={styles.oval} />
          <View style={styles.potCenter}>
            <View style={styles.potCard}>
              <Text style={styles.potCardText}>Total: {totalBB}</Text>
            </View>
          </View>
          {seats.map((seat, i) => (
            <SeatPill
              key={seat._id}
              seat={seat}
              isHostSeat={seat.userId === table.hostUserId}
              isMe={seat.userId === userId}
              isDealer={seat.seatIndex === effectiveDealerIdx}
              bigBlind={table.bigBlind}
              position={seatPosition(i, seats.length, meIndex)}
            />
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        {startError ? <Text style={styles.error}>{startError}</Text> : null}
        {isHost ? (
          <>
            <Pressable
              onPress={handleStart}
              disabled={!canStart}
              style={[styles.cta, !canStart && styles.ctaDisabled]}
            >
              <Text style={styles.ctaText}>Start game</Text>
            </Pressable>
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
          </>
        ) : (
          <>
            <Text style={styles.waitingForHost}>
              Waiting for host to start…
            </Text>
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
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function SeatPill({
  seat,
  isHostSeat,
  isMe,
  isDealer,
  bigBlind,
  position,
}: {
  seat: SeatWithProfile;
  isHostSeat: boolean;
  isMe: boolean;
  isDealer: boolean;
  bigBlind: number;
  position: { left: number; top: number };
}) {
  return (
    <View style={[styles.seatPill, position]}>
      {isHostSeat ? (
        <View style={styles.hostChip}>
          <MaterialCommunityIcons name="crown" size={9} color={colors.bg} />
        </View>
      ) : null}
      {isDealer ? (
        <View style={styles.dealerButton}>
          <Text style={styles.dealerButtonText}>B</Text>
        </View>
      ) : null}
      <View
        style={[styles.seatAvatar, { backgroundColor: colorHex(seat.color) }]}
      >
        <Text style={styles.seatAvatarText}>
          {seat.displayName.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.seatStackRow}>
        <Text style={styles.seatStack} numberOfLines={1}>
          {seat.chipStack / bigBlind}
        </Text>
      </View>
    </View>
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
  tableArea: {
    width: TABLE_W,
    height: TABLE_H,
  },
  oval: {
    position: "absolute",
    left: (TABLE_W - 210) / 2,
    top: (TABLE_H - 360) / 2,
    width: 210,
    height: 360,
    borderRadius: 160,
    backgroundColor: "#153023",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.08)",
  },
  potCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    top: TABLE_H / 2 - 11,
    alignItems: "center",
  },
  potCard: {
    height: 22,
    paddingHorizontal: 10,
    borderRadius: 11,
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
  potCardText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },

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
  seatAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  seatAvatarText: {
    color: "rgba(0,0,0,0.75)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  seatStackRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  seatStack: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 13,
    color: colors.gold,
  },
  // "B" = the Button (dealer position), circular ivory chip bottom-right.
  dealerButton: {
    position: "absolute",
    bottom: -5,
    right: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.ivory,
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
  dealerButtonText: {
    color: colors.bg,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  // Host crown — circular gold chip top-right. Mirrors the dealer button
  // visually so the two corner chips feel like one system.
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
  waitingForHost: {
    color: colors.mute,
    textAlign: "center",
    fontSize: 14,
    paddingVertical: 14,
  },
  error: {
    color: colors.danger,
    marginBottom: 8,
    textAlign: "center",
    fontSize: 13,
  },
});
