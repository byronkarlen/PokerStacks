import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useUserId } from "@/hooks/useUserId";
import { colorHex, colors, typography } from "@/theme";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type SeatWithProfile = Doc<"seats"> & { displayName: string; color: string };

const TABLE_W = 340;
const TABLE_H = 440;
const SEAT_RX = 148;
const SEAT_RY = 200;
const PILL_W = 128;
const PILL_H = 48;

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
  const userId = useUserId();

  const table = useQuery(api.tables.getByCode, { code });
  const seats = useQuery(
    api.tables.getSeatsWithProfile,
    table ? { tableId: table._id } : "skip",
  );

  const startGame = useMutation(api.tables.startGame);
  const endGame = useMutation(api.tables.endGame);
  const leaveTable = useMutation(api.tables.leaveTable);
  const setInitialDealer = useMutation(api.tables.setInitialDealer);
  const reorderSeats = useMutation(api.tables.reorderSeats);
  const kickPlayer = useMutation(api.tables.kickPlayer);

  useEffect(() => {
    if (table?.status === "active") {
      router.replace(`/table/${code}/hand`);
    } else if (table?.status === "ended") {
      // Pop back to whatever pushed us here (usually home) so the transition
      // slides left-to-right like a back gesture. If nothing is below
      // (e.g. resumed directly into this screen on launch), fall back to
      // replace which animates forward — not ideal but at least correct state.
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
  const [swapSourceId, setSwapSourceId] = useState<Id<"seats"> | null>(null);
  const [menuSeatId, setMenuSeatId] = useState<Id<"seats"> | null>(null);

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
  // Backend stores -1 to mean "no explicit pick" → default to seat 0 for
  // display. hands.ts will do the same thing when the first hand is dealt.
  const effectiveDealerIdx =
    table.dealerSeatIndex < 0 ? 0 : table.dealerSeatIndex;

  async function handleStart() {
    if (!userId || !table) return;
    setStartError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await startGame({ userId, tableId: table._id });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start");
    }
  }

  async function handleCancel() {
    if (!userId || !table || canceling) return;
    setCanceling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await endGame({ userId, tableId: table._id });
    } catch {
      setCanceling(false);
    }
  }

  async function handleLeave() {
    if (!userId || !table || leaving) return;
    setLeaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await leaveTable({ userId, tableId: table._id });
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/");
      }
    } catch {
      setLeaving(false);
    }
  }

  async function handleMakeDealer(seatId: Id<"seats">) {
    if (!userId || !table) return;
    Haptics.selectionAsync().catch(() => {});
    await setInitialDealer({ userId, tableId: table._id, seatId });
  }

  async function handleKick(seatId: Id<"seats">) {
    if (!userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await kickPlayer({ userId, seatId });
  }

  async function handleSwap(targetSeatId: Id<"seats">) {
    if (!swapSourceId || !userId || !table || !seats) return;
    if (swapSourceId === targetSeatId) {
      setSwapSourceId(null);
      return;
    }
    const a = seats.findIndex((s) => s._id === swapSourceId);
    const b = seats.findIndex((s) => s._id === targetSeatId);
    if (a < 0 || b < 0) return;
    const newOrder = seats.map((s) => s._id);
    [newOrder[a], newOrder[b]] = [newOrder[b], newOrder[a]];
    Haptics.selectionAsync().catch(() => {});
    await reorderSeats({
      userId,
      tableId: table._id,
      seatIdsInOrder: newOrder,
    });
    setSwapSourceId(null);
  }

  function handleSeatTap(seat: SeatWithProfile) {
    if (swapSourceId) {
      handleSwap(seat._id);
    } else {
      setMenuSeatId(seat._id);
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
          <View style={styles.centerLabel}>
            <Text style={styles.centerKicker}>On the table</Text>
            <Text style={styles.centerValue}>{totalBB} BB</Text>
          </View>
          {seats.map((seat, i) => (
            <SeatPill
              key={seat._id}
              seat={seat}
              isHostSeat={seat.userId === table.hostUserId}
              isMe={seat.userId === userId}
              isDealer={seat.seatIndex === effectiveDealerIdx}
              isSwapSource={swapSourceId === seat._id}
              isSwapTarget={!!swapSourceId && swapSourceId !== seat._id}
              bigBlind={table.bigBlind}
              position={seatPosition(i, seats.length, meIndex)}
              onPress={isHost ? () => handleSeatTap(seat) : undefined}
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

      {swapSourceId ? (
        <View style={styles.swapBanner}>
          <Text style={styles.swapBannerText}>
            Tap another seat to swap positions
          </Text>
          <Pressable
            onPress={() => setSwapSourceId(null)}
            hitSlop={12}
          >
            <Text style={styles.swapBannerCancel}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      <SeatMenu
        seat={
          menuSeatId ? seats.find((s) => s._id === menuSeatId) ?? null : null
        }
        isCurrentDealer={
          !!menuSeatId &&
          seats.find((s) => s._id === menuSeatId)?.seatIndex ===
            effectiveDealerIdx
        }
        isHostSeat={
          !!menuSeatId &&
          seats.find((s) => s._id === menuSeatId)?.userId ===
            table.hostUserId
        }
        onClose={() => setMenuSeatId(null)}
        onReorder={(seatId) => {
          setSwapSourceId(seatId);
          setMenuSeatId(null);
        }}
        onMakeDealer={(seatId) => {
          handleMakeDealer(seatId);
          setMenuSeatId(null);
        }}
        onKick={(seatId) => {
          handleKick(seatId);
          setMenuSeatId(null);
        }}
      />
    </SafeAreaView>
  );
}

function SeatMenu({
  seat,
  isCurrentDealer,
  isHostSeat,
  onClose,
  onReorder,
  onMakeDealer,
  onKick,
}: {
  seat: SeatWithProfile | null;
  isCurrentDealer: boolean;
  isHostSeat: boolean;
  onClose: () => void;
  onReorder: (seatId: Id<"seats">) => void;
  onMakeDealer: (seatId: Id<"seats">) => void;
  onKick: (seatId: Id<"seats">) => void;
}) {
  if (!seat) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose}>
        <Pressable style={styles.menuCard} onPress={() => {}}>
          <Text style={styles.menuTitle}>{seat.displayName}</Text>
          <Pressable
            style={styles.menuItem}
            onPress={() => onReorder(seat._id)}
          >
            <Text style={styles.menuItemText}>Reorder</Text>
          </Pressable>
          {!isCurrentDealer ? (
            <Pressable
              style={styles.menuItem}
              onPress={() => onMakeDealer(seat._id)}
            >
              <Text style={styles.menuItemText}>Make dealer</Text>
            </Pressable>
          ) : null}
          {!isHostSeat ? (
            <Pressable
              style={styles.menuItem}
              onPress={() => onKick(seat._id)}
            >
              <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>
                Kick from table
              </Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.menuItem} onPress={onClose}>
            <Text style={styles.menuItemText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SeatPill({
  seat,
  isHostSeat,
  isMe,
  isDealer,
  isSwapSource,
  isSwapTarget,
  bigBlind,
  position,
  onPress,
}: {
  seat: SeatWithProfile;
  isHostSeat: boolean;
  isMe: boolean;
  isDealer: boolean;
  isSwapSource: boolean;
  isSwapTarget: boolean;
  bigBlind: number;
  position: { left: number; top: number };
  onPress?: () => void;
}) {
  const content = (
    <>
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
      <View style={styles.seatInfo}>
        <Text style={styles.seatName} numberOfLines={1}>
          {isMe ? "Me" : seat.displayName}
          {isHostSeat ? <Text style={styles.seatBadge}>  HOST</Text> : null}
        </Text>
        <Text style={styles.seatStack} numberOfLines={1}>
          {seat.chipStack / bigBlind} BB
        </Text>
      </View>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={[
          styles.seatPill,
          position,
          isMe && styles.seatPillMe,
          isSwapSource && styles.seatPillSwapSource,
          isSwapTarget && styles.seatPillSwapTarget,
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={[styles.seatPill, position, isMe && styles.seatPillMe]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },
  loadingText: { color: colors.mute, fontSize: 14 },

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
    left: (TABLE_W - 220) / 2,
    top: (TABLE_H - 320) / 2,
    width: 220,
    height: 320,
    borderRadius: 160,
    backgroundColor: "#153023",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.08)",
  },
  centerLabel: {
    position: "absolute",
    left: 0,
    right: 0,
    top: TABLE_H / 2 - 28,
    alignItems: "center",
  },
  centerKicker: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  centerValue: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 28,
    color: colors.ivory,
    marginTop: 4,
  },

  seatPill: {
    position: "absolute",
    width: PILL_W,
    height: PILL_H,
    borderRadius: 24,
    backgroundColor: "#14231b",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.18)",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 4,
    paddingRight: 8,
    gap: 8,
  },
  seatPillMe: {
    borderColor: colors.gold,
  },
  seatPillSwapSource: {
    borderColor: colors.ivory,
    borderWidth: 2,
    opacity: 1,
  },
  seatPillSwapTarget: {
    opacity: 0.7,
  },
  seatAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  seatAvatarText: {
    color: "rgba(0,0,0,0.75)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  seatInfo: { flex: 1, minWidth: 0 },
  seatName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  seatBadge: {
    color: colors.gold,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  seatStack: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 14,
    color: colors.gold,
    marginTop: 1,
  },
  // Dealer "BUTTON" — a circular ivory chip that sits on the seat pill's
  // corner. Poker convention: "B" = the Button (dealer position).
  dealerButton: {
    position: "absolute",
    bottom: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ivory,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  dealerButtonText: {
    color: colors.bg,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: -0.3,
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
    color: "#d07070",
    marginBottom: 8,
    textAlign: "center",
    fontSize: 13,
  },

  // Seat context menu (long-press-app style)
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  menuCard: {
    width: "100%",
    backgroundColor: "rgba(20,35,27,0.96)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.2)",
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 8,
  },
  menuTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 10,
  },
  menuItem: {
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  menuItemText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "500",
  },
  menuItemTextDanger: {
    color: colors.danger,
  },

  // Swap-mode banner
  swapBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: "rgba(20,35,27,0.96)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairStrong,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  swapBannerText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
  swapBannerCancel: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
