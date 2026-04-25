import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useMe } from "@/hooks/useMe";
import { colorHex, colors, typography } from "@/theme";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

type SeatWithProfile = Doc<"seats"> & { displayName: string };
type Hand = Doc<"hands">;
type Action = Doc<"actions">;

// Oval-table geometry — mirrors the lobby screen so the table feels continuous
// across the two screens. "Me" is pinned to the bottom; other seats rotate
// around clockwise from there.
const TABLE_W = 340;
const TABLE_H = 440;
const SEAT_RX = 125;
const SEAT_RY = 200;
const PILL_W = 78;
const PILL_H = 28;

function seatPosition(index: number, total: number, meIndex: number) {
  const angle = ((index - meIndex) / total) * Math.PI * 2 + Math.PI / 2;
  const cx = TABLE_W / 2;
  const cy = TABLE_H / 2;
  return {
    left: cx + SEAT_RX * Math.cos(angle) - PILL_W / 2,
    top: cy + SEAT_RY * Math.sin(angle) - PILL_H / 2,
  };
}

const BET_H = 22;
// The anchor is a fixed-width centering frame. The chip inside has no width
// constraint and shrink-wraps to its content — so "1" looks tight, "999"
// gets all the room it needs, both centered on the rail.
const BET_ANCHOR_W = 60;

// Community board: 5 slots that fill as streets progress.
const COMMUNITY_CARD_W = 16;
const COMMUNITY_CARD_H = 22;
// Hole cards peek above each seat pill — sized to match the community cards
// on the felt so all face-down cards read as the same deck.
const HOLE_CARD_W = COMMUNITY_CARD_W;
const HOLE_CARD_H = COMMUNITY_CARD_H;

// Anchor point (center) for the bet chip. The chip itself is wrapped in a
// zero-size anchor View with flex-centered children so it shrink-wraps to
// its own content (no trailing whitespace on short amounts).
// Bet chip sits directly below its pill for top/side seats, and above the
// pill (clearing the hole cards) for bottom-half seats. Ownership stays
// unambiguous and nothing gets pushed off the tableArea bottom.
function betPosition(index: number, total: number, meIndex: number) {
  const angle = ((index - meIndex) / total) * Math.PI * 2 + Math.PI / 2;
  const cx = TABLE_W / 2;
  const cy = TABLE_H / 2;
  const pillCx = cx + SEAT_RX * Math.cos(angle);
  const pillCy = cy + SEAT_RY * Math.sin(angle);
  const isBottomHalf = pillCy > cy;
  const top = isBottomHalf
    ? pillCy - PILL_H / 2 - (HOLE_CARD_H - 4) - BET_H - 4
    : pillCy + PILL_H / 2 + 4;
  return {
    left: pillCx - BET_ANCHOR_W / 2,
    top,
  };
}

// Dealer button (rendered as a top-level child of tableArea so it can animate
// across pills when the button moves between hands). Anchors to the
// bottom-right of the pill to match the original in-pill placement.
const DEALER_BTN_SIZE = 16;
function dealerButtonPosition(
  index: number,
  total: number,
  meIndex: number,
): { left: number; top: number } {
  const seatPos = seatPosition(index, total, meIndex);
  return {
    left: seatPos.left + PILL_W - DEALER_BTN_SIZE + 5,
    top: seatPos.top + PILL_H - DEALER_BTN_SIZE + 5,
  };
}

const DEALER_ANIM_MS = 500;
// Blinds reveal sequence: SB pops in after the dealer button settles, then BB
// after a brief beat. ANIM_TOTAL_MS is when the table returns to its normal
// state (animPhase = "done").
const SB_DELAY_MS = 700;
const BB_DELAY_MS = 1100;
const POP_ANIM_MS = 280;
const ANIM_TOTAL_MS = 1500;

function communityCardCount(street: Hand["street"]): number {
  if (street === "preflop") return 0;
  if (street === "flop") return 3;
  if (street === "turn") return 4;
  return 5; // river, showdown, complete
}

// =============================================================================
// Screen
// =============================================================================

export default function HandScreen() {
  useKeepAwake();
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const me = useMe();
  const userId = me?._id;

  const table = useQuery(api.games.getByCode, { code });
  const seats = useQuery(
    api.games.getSeatsWithProfile,
    table ? { gameId: table._id } : "skip",
  );
  const handView = useQuery(
    api.hands.getHandView,
    table ? { gameId: table._id } : "skip",
  );
  // Pot breakdown. Only multi-pot (i.e. with side pots) is interesting to
  // display; the Total pill covers the common case.
  const potStructure = useQuery(
    api.hands.getPotStructure,
    handView?.hand ? { handId: handView.hand._id } : "skip",
  );

  const startHand = useMutation(api.hands.startHand);
  const endGame = useMutation(api.games.endGame);
  const [endError, setEndError] = useState<string | null>(null);

  // Auto-route on table state changes.
  useEffect(() => {
    if (table?.status === "ended") {
      router.replace(`/table/${code}/settle`);
    } else if (table?.status === "lobby") {
      router.replace(`/table/${code}/lobby`);
    }
  }, [table?.status, code, router]);

  // Auto-start first hand once we're on the hand screen. Host-only (the
  // mutation is gated to host), so only the host's client fires this.
  const isHost = !!userId && table?.hostUserId === userId;
  const startedRef = useRef(false);
  useEffect(() => {
    if (
      isHost &&
      table?.status === "active" &&
      table?.currentHandId === undefined &&
      !startedRef.current
    ) {
      startedRef.current = true;
      startHand({ gameId: table._id }).catch(() => {
        // Probably < 2 seats with chips; reset so the host can try later.
        startedRef.current = false;
      });
    }
  }, [isHost, table?.status, table?.currentHandId, table?._id, startHand]);

  // Haptic on "your turn" arrival and on hand completion.
  const lastToActRef = useRef<number | undefined>(undefined);
  const lastStreetRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const hand = handView?.hand;
    const mySeatIndex = (handView && userId)
      ? seats?.find((s) => s.userId === userId)?.seatIndex
      : undefined;

    const newToAct = hand?.toActSeatIndex;
    if (
      newToAct !== undefined &&
      newToAct === mySeatIndex &&
      lastToActRef.current !== newToAct
    ) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
    }
    lastToActRef.current = newToAct;

    const newStreet = hand?.street;
    if (
      newStreet === "complete" &&
      lastStreetRef.current !== "complete" &&
      lastStreetRef.current !== undefined
    ) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    }
    lastStreetRef.current = newStreet;
  }, [handView, seats, userId]);

  // Hand-transition animation timeline. When the current hand changes (a hand
  // ended and the next one auto-started), step the table through:
  //   "dealer"  → dealer button slides to its new seat
  //   "sb"      → SB chip pops in, displayed pot becomes SB
  //   "bb"      → BB chip pops in, displayed pot becomes SB+BB
  //   "done"    → normal state (pot reflects hand.pot, no entering anims)
  // First time we see a hand on the screen we go straight to "done" — there's
  // no prior hand to transition from.
  const [animPhase, setAnimPhase] = useState<
    "dealer" | "sb" | "bb" | "done"
  >("done");
  const prevAnimHandIdRef = useRef<Id<"hands"> | undefined>(undefined);
  const currentHandId = handView?.hand?._id;
  useEffect(() => {
    if (!currentHandId) {
      prevAnimHandIdRef.current = undefined;
      setAnimPhase("done");
      return;
    }
    if (prevAnimHandIdRef.current === undefined) {
      prevAnimHandIdRef.current = currentHandId;
      return;
    }
    if (prevAnimHandIdRef.current === currentHandId) return;
    prevAnimHandIdRef.current = currentHandId;
    setAnimPhase("dealer");
    const t1 = setTimeout(() => setAnimPhase("sb"), SB_DELAY_MS);
    const t2 = setTimeout(() => setAnimPhase("bb"), BB_DELAY_MS);
    const t3 = setTimeout(() => setAnimPhase("done"), ANIM_TOTAL_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [currentHandId]);

  if (!table || !seats || handView === undefined || !userId) {
    return (
      <SafeAreaView style={[styles.container, styles.loading]}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  const mySeat = seats.find((s) => s.userId === userId);
  const hand = handView?.hand;
  const actions = handView?.actions ?? [];

  // Detect hand transition synchronously in render so the SB/BB chips can
  // attach their `entering` animation on the very first mount with the new
  // hand id (otherwise they'd flash full-size for one frame before the
  // useEffect-driven phase update kicks in).
  const isHandTransitionStart =
    !!hand &&
    prevAnimHandIdRef.current !== undefined &&
    prevAnimHandIdRef.current !== hand._id;
  const effectivePhase = isHandTransitionStart ? "dealer" : animPhase;
  const animatingTransition = effectivePhase !== "done";

  // SB/BB seats and amounts on the current hand, used to drive the staggered
  // pot reveal and the per-chip entering animations.
  const sbAction = actions.find((a) => a.type === "post_sb");
  const bbAction = actions.find((a) => a.type === "post_bb");
  const sbSeatId = sbAction?.seatId;
  const bbSeatId = bbAction?.seatId;
  const sbAmount = sbAction?.amount ?? 0;
  const bbAmount = bbAction?.amount ?? 0;

  // Displayed pot during the transition steps up: 0 → SB → SB+BB → actual.
  // After "done", we just mirror hand.pot.
  const displayedPot = !hand
    ? 0
    : effectivePhase === "dealer"
      ? 0
      : effectivePhase === "sb"
        ? sbAmount
        : effectivePhase === "bb"
          ? sbAmount + bbAmount
          : hand.pot;

  // Per-seat chips put in on the CURRENT betting street. Cleared when the
  // street advances (actions from prior streets don't match) — mirrors what
  // live tables do when chips get swept into the pot between streets.
  const committedByStreet = new Map<Id<"seats">, number>();
  if (
    hand &&
    (hand.street === "preflop" ||
      hand.street === "flop" ||
      hand.street === "turn" ||
      hand.street === "river")
  ) {
    for (const a of actions) {
      if (a.street !== hand.street) continue;
      committedByStreet.set(
        a.seatId,
        (committedByStreet.get(a.seatId) ?? 0) + a.amount,
      );
    }
  }

  async function handleEndGame() {
    setEndError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await endGame({ gameId: table!._id });
      router.replace(`/table/${code}/settle`);
    } catch (e) {
      setEndError(e instanceof Error ? e.message : "Failed to end game");
    }
  }

  const meIndex = Math.max(
    0,
    seats.findIndex((s) => s.userId === userId),
  );
  const handNumber = hand?.handNumber;
  const streetText = hand ? streetLabel(hand) : "Between hands";

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topKicker}>
            {handNumber ? `Hand ${handNumber} · ` : ""}
            {streetText}
          </Text>
          <Text style={styles.topSub}>
            {table.smallBlind}/{table.bigBlind} · {table.code}
          </Text>
        </View>
        {isHost ? (
          <Pressable onPress={handleEndGame} hitSlop={8}>
            <Text style={styles.endGameBtn}>End</Text>
          </Pressable>
        ) : null}
      </View>

      {endError ? <Text style={styles.errorInline}>{endError}</Text> : null}

      <View style={styles.tableWrap}>
        <Animated.View style={styles.tableArea} layout={LinearTransition}>
          <View style={styles.oval} />
          <View style={styles.potCenter}>
            <View style={styles.potCard}>
              <Text style={styles.potCardText}>
                Total: {displayedPot / table.bigBlind}
              </Text>
            </View>
            {potStructure && potStructure.pots.length > 1
              ? potStructure.pots.map((pot, i) => (
                  <View key={pot.index} style={styles.subPotCard}>
                    <Text style={styles.subPotText}>
                      {i === 0 ? "Main pot" : "Side pot"}:{" "}
                      {pot.amount / table.bigBlind}
                    </Text>
                  </View>
                ))
              : null}
            <View style={styles.cardRow}>
              {[0, 1, 2, 3, 4].map((i) => {
                const revealed =
                  i < communityCardCount(hand?.street ?? "preflop");
                return (
                  <View
                    key={i}
                    style={revealed ? styles.cardBack : styles.cardSlot}
                  />
                );
              })}
            </View>
            <Text style={styles.streetLabel}>
              {streetText.toUpperCase()}
            </Text>
          </View>
          {/* Hole cards behind active seats, rendered before pills so the
              pill overlaps the bottom half of the cards. Skipped for folded
              and busted-inactive seats (both are out of the hand). */}
          {hand && hand.street !== "complete"
            ? seats.map((seat, i) => {
                const isFoldedSeat = actions.some(
                  (a) => a.type === "fold" && a.seatId === seat._id,
                );
                if (isFoldedSeat || seat.status === "inactive") return null;
                const pos = seatPosition(i, seats.length, meIndex);
                // Cards sit above the pill, with only ~4px tucked behind the
                // top edge so most of each card reads clearly. Two cards are
                // fanned 8° apart with a partial overlap for a "fanned hand"
                // look. Centered horizontally over the pill.
                const HOLE_CARDS_W = HOLE_CARD_W + 14; // fan spread
                return (
                  <View
                    key={`hole-${seat._id}`}
                    style={[
                      styles.holeCards,
                      {
                        width: HOLE_CARDS_W,
                        left: pos.left + PILL_W / 2 - HOLE_CARDS_W / 2,
                        top: pos.top - HOLE_CARD_H + 4,
                      },
                    ]}
                  >
                    <View style={[styles.holeCard, styles.holeCardLeft]} />
                    <View style={[styles.holeCard, styles.holeCardRight]} />
                  </View>
                );
              })
            : null}
          {seats.map((seat, i) => (
            <HandSeatPill
              key={seat._id}
              seat={seat}
              isHostSeat={seat.userId === table.hostUserId}
              isMe={seat.userId === userId}
              isToAct={
                hand?.toActSeatIndex !== undefined &&
                hand.toActSeatIndex === seat.seatIndex
              }
              isFolded={
                seat.status === "inactive" ||
                actions.some(
                  (a) => a.type === "fold" && a.seatId === seat._id,
                )
              }
              bigBlind={table.bigBlind}
              position={seatPosition(i, seats.length, meIndex)}
            />
          ))}
          <DealerButton
            seats={seats}
            meIndex={meIndex}
            dealerSeatIndex={
              hand
                ? hand.dealerSeatIndex
                : table.dealerSeatIndex < 0
                  ? 0
                  : table.dealerSeatIndex
            }
            handId={hand?._id}
          />
          {seats.map((seat, i) => {
            const amount = committedByStreet.get(seat._id) ?? 0;
            if (amount === 0) return null;
            // Pop-in animation runs whenever a chip first appears for a seat
            // on the current street. The blinds on a fresh hand wait for the
            // dealer-button slide to finish before they pop; everything else
            // pops in immediately at mount.
            const isSbBlind =
              animatingTransition && seat._id === sbSeatId;
            const isBbBlind =
              animatingTransition && seat._id === bbSeatId;
            const entering = isSbBlind
              ? ZoomIn.delay(SB_DELAY_MS).duration(POP_ANIM_MS).springify()
              : isBbBlind
                ? ZoomIn.delay(BB_DELAY_MS).duration(POP_ANIM_MS).springify()
                : ZoomIn.duration(POP_ANIM_MS).springify();
            return (
              <Animated.View
                // Key includes hand id and street so the chip remounts (and
                // re-runs its entering animation) when a player first
                // contributes on a new street, not just on a new hand.
                key={`bet-${hand?._id}-${hand?.street}-${seat._id}`}
                entering={entering}
                style={[
                  styles.betChipAnchor,
                  betPosition(i, seats.length, meIndex),
                ]}
                pointerEvents="none"
              >
                <View style={styles.betChip}>
                  <MaterialCommunityIcons
                    name="poker-chip"
                    size={11}
                    color={colors.gold}
                  />
                  <Text style={styles.betChipText}>{amount}</Text>
                </View>
              </Animated.View>
            );
          })}
        </Animated.View>
      </View>

      <ActionDock
        table={table}
        hand={hand ?? null}
        actions={actions}
        seats={seats}
        mySeat={mySeat ?? null}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// HandSeatPill
// =============================================================================

function HandSeatPill({
  seat,
  isHostSeat,
  isMe,
  isToAct,
  isFolded,
  bigBlind,
  position,
}: {
  seat: SeatWithProfile;
  isHostSeat: boolean;
  isMe: boolean;
  isToAct: boolean;
  isFolded: boolean;
  bigBlind: number;
  position: { left: number; top: number };
}) {
  return (
    <View style={[position, { width: PILL_W }]}>
      <View
        style={[
          styles.handSeatPill,
          isToAct && styles.handSeatPillToAct,
          isFolded && styles.handSeatPillFolded,
        ]}
      >
        {isHostSeat ? (
          <View style={styles.handHostChip}>
            <MaterialCommunityIcons name="crown" size={9} color={colors.bg} />
          </View>
        ) : null}
        <View
          style={[
            styles.handSeatAvatar,
            { backgroundColor: colorHex(seat.color) },
          ]}
        >
          <Text style={styles.handSeatAvatarText}>
            {seat.displayName.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.handSeatStackRow}>
          <Text style={styles.handSeatStack} numberOfLines={1}>
            {seat.chipStack / bigBlind}
          </Text>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// DealerButton
// =============================================================================

// Top-level dealer button rendered as a child of tableArea. Animates between
// seat positions when the hand changes (button rotates clockwise to the next
// active player). On first mount we snap to the current dealer with no
// animation.
function DealerButton({
  seats,
  meIndex,
  dealerSeatIndex,
  handId,
}: {
  seats: SeatWithProfile[];
  meIndex: number;
  dealerSeatIndex: number;
  handId: Id<"hands"> | undefined;
}) {
  const dealerArrayIdx = Math.max(
    0,
    seats.findIndex((s) => s.seatIndex === dealerSeatIndex),
  );
  const target = dealerButtonPosition(dealerArrayIdx, seats.length, meIndex);

  const left = useSharedValue(target.left);
  const top = useSharedValue(target.top);
  // Track which hand we last animated for so we only animate on hand
  // transitions, not on every render or on screen mount.
  const prevHandIdRef = useRef<Id<"hands"> | undefined>(handId);

  useEffect(() => {
    if (prevHandIdRef.current === handId) {
      // Same hand (or both undefined). Keep position in sync without
      // animating in case seats reorder or meIndex shifts.
      left.value = target.left;
      top.value = target.top;
      return;
    }
    if (prevHandIdRef.current === undefined) {
      // First hand seen on this screen — snap, don't slide.
      left.value = target.left;
      top.value = target.top;
    } else {
      left.value = withTiming(target.left, { duration: DEALER_ANIM_MS });
      top.value = withTiming(target.top, { duration: DEALER_ANIM_MS });
    }
    prevHandIdRef.current = handId;
  }, [handId, target.left, target.top, left, top]);

  const animatedStyle = useAnimatedStyle(() => ({
    left: left.value,
    top: top.value,
  }));

  return (
    <Animated.View style={[styles.handDealerButton, animatedStyle]}>
      <Text style={styles.handDealerButtonText}>B</Text>
    </Animated.View>
  );
}

// =============================================================================
// Action dock
// =============================================================================

function ActionDock({
  table,
  hand,
  actions,
  seats,
  mySeat,
}: {
  table: Doc<"games">;
  hand: Hand | null;
  actions: Action[];
  seats: SeatWithProfile[];
  mySeat: SeatWithProfile | null;
}) {
  // No hand in progress — waiting for auto-start.
  if (!hand || hand.street === "complete") {
    return (
      <View style={styles.dock}>
        <Text style={styles.dockMuted}>Waiting for next hand…</Text>
      </View>
    );
  }

  // Showdown — anyone can pick the winner.
  if (hand.street === "showdown") {
    return <ShowdownDock hand={hand} seats={seats} />;
  }

  const toActSeat =
    hand.toActSeatIndex !== undefined
      ? seats.find((s) => s.seatIndex === hand.toActSeatIndex)
      : undefined;
  if (!toActSeat) {
    return (
      <View style={styles.dock}>
        <Text style={styles.dockMuted}>Waiting for next hand…</Text>
      </View>
    );
  }

  const isMyTurn = !!mySeat && hand.toActSeatIndex === mySeat.seatIndex;

  return (
    <TurnDock
      table={table}
      hand={hand}
      actions={actions}
      mySeat={mySeat}
      toActSeat={toActSeat}
      isMyTurn={isMyTurn}
    />
  );
}

// -----------------------------------------------------------------------------
// TurnDock
// -----------------------------------------------------------------------------

function TurnDock({
  table,
  hand,
  actions,
  mySeat,
  toActSeat,
  isMyTurn,
}: {
  table: Doc<"games">;
  hand: Hand;
  actions: Action[];
  mySeat: SeatWithProfile | null;
  toActSeat: SeatWithProfile;
  isMyTurn: boolean;
}) {
  const recordAction = useMutation(api.hands.recordAction);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Drag handle: swipe down on the header to collapse, swipe up to expand;
  // a short press without movement toggles. Attached to a plain View —
  // Pressable's own responder system would swallow the pan gesture.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 4 || Math.abs(g.dx) > 4,
      onPanResponderRelease: (_, g) => {
        if (g.dy > 16) setCollapsed(true);
        else if (g.dy < -16) setCollapsed(false);
        else if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) {
          setCollapsed((c) => !c);
        }
      },
    }),
  ).current;

  const myStreetCommit = useMemo(() => {
    if (!mySeat) return 0;
    const street =
      hand.street === "showdown" || hand.street === "complete"
        ? "river"
        : hand.street;
    let total = 0;
    for (const a of actions) {
      if (a.street !== street) continue;
      if (a.seatId !== mySeat._id) continue;
      total += a.amount;
    }
    return total;
  }, [actions, hand, mySeat]);

  // Reopening rule: if a short all-in happened after the caller already
  // acted, the caller can only call or fold — no re-raise.
  const myActionClosed = useMemo(() => {
    if (!mySeat) return false;
    const reopenSeq = hand.lastFullRaiseSequence;
    if (reopenSeq === undefined) return false;
    const street =
      hand.street === "showdown" || hand.street === "complete"
        ? "river"
        : hand.street;
    return actions.some(
      (a) =>
        a.seatId === mySeat._id &&
        a.street === street &&
        a.sequence >= reopenSeq &&
        a.type !== "post_sb" &&
        a.type !== "post_bb",
    );
  }, [actions, hand, mySeat]);

  // A "live" opponent is another participant who is still eligible to bet
  // (not folded, not already all-in). If nobody matches that, any extra
  // chips we put in just spawn a side pot only we contribute to — pointless
  // aggression.
  const hasLiveOpponent = useMemo(() => {
    if (!mySeat) return false;
    const participants = new Set<Id<"seats">>();
    const folded = new Set<Id<"seats">>();
    const allIn = new Set<Id<"seats">>();
    for (const a of actions) {
      participants.add(a.seatId);
      if (a.type === "fold") folded.add(a.seatId);
      if (a.type === "all_in") allIn.add(a.seatId);
    }
    for (const sid of participants) {
      if (sid === mySeat._id) continue;
      if (folded.has(sid)) continue;
      if (allIn.has(sid)) continue;
      return true;
    }
    return false;
  }, [actions, mySeat]);

  const callAmount = Math.max(0, hand.currentBet - myStreetCommit);
  const canCheck = !!mySeat && hand.currentBet === myStreetCommit;
  const canCall = !!mySeat && !canCheck && callAmount > 0;
  // Aggression (bet / raise / short all-in) is only meaningful when at least
  // one opponent can still match it. It's also blocked when the player's
  // action is closed by the short-all-in reopening rule.
  const canAggress =
    !!mySeat &&
    !myActionClosed &&
    hasLiveOpponent &&
    mySeat.chipStack > 0;
  const canBet =
    canAggress && hand.currentBet === 0 && mySeat!.chipStack >= table.bigBlind;
  // A legal raise additionally needs the stack to reach (currentBet +
  // minRaise). A player short of that can only all-in, which still requires
  // a live opponent to be meaningful (covered by canAggress).
  const canRaise =
    canAggress &&
    hand.currentBet > 0 &&
    mySeat!.chipStack > callAmount &&
    myStreetCommit + mySeat!.chipStack >= hand.currentBet + hand.minRaise;
  const canBetOrRaise = canBet || canRaise;

  // Bet-sizing state for the inline slider + quick buttons.
  const minTarget = canBet ? table.bigBlind : hand.currentBet + hand.minRaise;
  const maxTarget = mySeat ? myStreetCommit + mySeat.chipStack : minTarget;
  const clampedMin = Math.min(minTarget, maxTarget);
  const [target, setTarget] = useState(clampedMin);

  useEffect(() => {
    setTarget(clampedMin);
  }, [hand._id, hand.street, hand.currentBet, clampedMin]);

  const roundToHalf = (v: number) => Math.round(v * 2) / 2;
  const clamp = (v: number) =>
    Math.max(clampedMin, Math.min(maxTarget, roundToHalf(v)));
  const multiplierBase = hand.currentBet > 0 ? hand.currentBet : table.bigBlind;
  const potTarget = (fraction: number): number => {
    const P = hand.pot;
    const B = hand.currentBet;
    const C = myStreetCommit;
    if (B === 0) return P * fraction;
    return B + fraction * (P + B - C);
  };
  const isPreflop = hand.street === "preflop";

  async function fire(
    type: "check" | "call" | "fold" | "all_in" | "bet" | "raise",
    opts?: { amount?: number; onBehalfOf?: Id<"seats"> },
  ) {
    setError(null);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await recordAction({
        handId: hand._id,
        type,
        amount: opts?.amount,
        onBehalfOf: opts?.onBehalfOf,
      });
      // Stays open by default — user controls collapse with a tap or a
      // swipe-down on the header.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const raiseLabel = canBet
    ? `Bet ${target}`
    : canRaise
    ? `Raise to ${target}`
    : "All-in";

  const turnLabel = isMyTurn ? "Your turn" : `${toActSeat.displayName}'s turn`;

  return (
    <Animated.View style={styles.turnDock} layout={LinearTransition}>
      <View style={styles.turnDockHeader} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
        <Text style={styles.turnDockHeaderText}>{turnLabel}</Text>
      </View>

      {!collapsed ? (
        <View style={styles.turnDockBody}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {isMyTurn && mySeat ? (
            <>
              <View style={styles.actionRow}>
                {!canCheck ? (
                  <ActionButton
                    label="Fold"
                    tone="fold"
                    onPress={() => fire("fold")}
                    disabled={busy}
                  />
                ) : null}
                {canCheck ? (
                  <ActionButton
                    label="Check"
                    tone="call"
                    onPress={() => fire("check")}
                    disabled={busy}
                  />
                ) : (
                  <ActionButton
                    label={`Call ${callAmount}`}
                    tone="call"
                    onPress={() => fire("call")}
                    disabled={busy || !canCall}
                  />
                )}
                {canAggress ? (
                  <ActionButton
                    label={raiseLabel}
                    tone="raise"
                    onPress={() => {
                      // Short all-ins (below min-raise) must go through
                      // "all_in" since the server rejects "raise" amounts
                      // under minRaise.
                      if (canBetOrRaise && target >= maxTarget) fire("all_in");
                      else if (canBet) fire("bet", { amount: target });
                      else if (canRaise) fire("raise", { amount: target });
                      else fire("all_in");
                    }}
                    disabled={busy}
                  />
                ) : null}
              </View>

              {canBetOrRaise && clampedMin < maxTarget ? (
                <>
                  <View style={styles.sliderRow}>
                    <Pressable
                      onPress={() =>
                        setTarget((t) => clamp(t - table.smallBlind))
                      }
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        pressed && styles.btnPressed,
                      ]}
                      hitSlop={4}
                    >
                      <Text style={styles.stepBtnText}>−</Text>
                    </Pressable>
                    <Slider
                      style={styles.slider}
                      minimumValue={clampedMin}
                      maximumValue={maxTarget}
                      step={table.bigBlind}
                      value={target}
                      onValueChange={(v) => setTarget(Math.round(v))}
                      minimumTrackTintColor={colors.gold}
                      maximumTrackTintColor={colors.hairStrong}
                      thumbTintColor={colors.gold}
                      disabled={busy}
                    />
                    <Pressable
                      onPress={() =>
                        setTarget((t) => clamp(t + table.smallBlind))
                      }
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        pressed && styles.btnPressed,
                      ]}
                      hitSlop={4}
                    >
                      <Text style={styles.stepBtnText}>+</Text>
                    </Pressable>
                  </View>
                  <View style={styles.quickRow}>
                    {isPreflop ? (
                      <>
                        <QuickButton
                          label="x3"
                          onPress={() =>
                            setTarget(clamp(multiplierBase * 3))
                          }
                          disabled={busy}
                        />
                        <QuickButton
                          label="x5"
                          onPress={() =>
                            setTarget(clamp(multiplierBase * 5))
                          }
                          disabled={busy}
                        />
                      </>
                    ) : (
                      <>
                        <QuickButton
                          label="½ Pot"
                          onPress={() => setTarget(clamp(potTarget(0.5)))}
                          disabled={busy}
                        />
                        <QuickButton
                          label="¾ Pot"
                          onPress={() => setTarget(clamp(potTarget(0.75)))}
                          disabled={busy}
                        />
                      </>
                    )}
                    <QuickButton
                      label="Pot"
                      onPress={() => setTarget(clamp(potTarget(1)))}
                      disabled={busy}
                    />
                    <QuickButton
                      label="All in"
                      onPress={() => setTarget(maxTarget)}
                      disabled={busy}
                    />
                  </View>
                </>
              ) : null}
            </>
          ) : (
            // Not my turn — offer the AFK fold. Useful when a player is in
            // the bathroom / away from the device; anyone at the table can
            // fold for them. Wrapped in an actionRow so the button's flex:1
            // stretches horizontally the way it does beside other buttons.
            <View style={styles.actionRow}>
              <ActionButton
                label="Fold"
                tone="fold"
                onPress={() => fire("fold", { onBehalfOf: toActSeat._id })}
                disabled={busy || !mySeat}
              />
            </View>
          )}
        </View>
      ) : null}
    </Animated.View>
  );
}

function QuickButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.quickBtn,
        pressed && styles.btnPressed,
        disabled && styles.ctaDisabled,
      ]}
    >
      <Text style={styles.quickBtnText}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  onPress,
  tone,
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone: "fold" | "call" | "raise";
  disabled?: boolean;
}) {
  // When disabled, drop the tone-specific accent (red/green/gold) and fall
  // back to a neutral treatment so the button reads as "off" rather than
  // "tinted but dim." Opacity alone isn't enough — a 40% red button still
  // looks like a red button.
  const toneStyle = disabled
    ? styles.actionBtnInactive
    : tone === "fold"
    ? styles.actionBtnFold
    : tone === "call"
    ? styles.actionBtnCall
    : styles.actionBtnRaise;
  const textStyle = disabled
    ? styles.actionBtnTextInactive
    : tone === "fold"
    ? styles.actionBtnTextFold
    : tone === "call"
    ? styles.actionBtnTextCall
    : styles.actionBtnTextRaise;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionBtn,
        toneStyle,
        pressed && styles.btnPressed,
      ]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// ShowdownDock
// -----------------------------------------------------------------------------

function ShowdownDock({
  hand,
  seats,
}: {
  hand: Hand;
  seats: SeatWithProfile[];
}) {
  const pickPotWinner = useMutation(api.hands.pickPotWinner);
  const potStructure = useQuery(api.hands.getPotStructure, { handId: hand._id });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!potStructure) {
    return (
      <View style={styles.turnDock}>
        <View style={styles.turnDockHeader}>
          <Text style={styles.turnDockHeaderText}>Loading pots…</Text>
        </View>
      </View>
    );
  }

  const pots = potStructure.pots;
  // Step is derived from server state so every client advances together as
  // picks are made. hand.pendingAwards is appended to by pickPotWinner.
  const step = hand.pendingAwards?.length ?? 0;
  const currentPot = pots[step];

  async function pickWinner(seatId: Id<"seats">) {
    if (busy || !currentPot) return;
    setError(null);
    setBusy(true);
    try {
      await pickPotWinner({
        handId: hand._id,
        potIndex: currentPot.index,
        seatId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Award failed");
    } finally {
      setBusy(false);
    }
  }

  if (!currentPot) {
    return (
      <View style={styles.turnDock}>
        <View style={styles.turnDockHeader}>
          <Text style={styles.turnDockHeaderText}>No pot to award</Text>
        </View>
      </View>
    );
  }

  const eligible = currentPot.eligibleSeatIds
    .map((id) => seats.find((s) => s._id === id))
    .filter((s): s is SeatWithProfile => !!s);
  const potLabel = step === 0 ? "Main Pot Winner" : "Side Pot Winner";

  return (
    <Animated.View style={styles.turnDock} layout={LinearTransition}>
      <View style={styles.turnDockHeader}>
        <Text style={styles.turnDockHeaderText}>{potLabel}</Text>
      </View>
      <View style={styles.turnDockBody}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.showdownRow}>
          {eligible.map((seat) => {
            const seatColor = colorHex(seat.color);
            return (
              <Pressable
                key={seat._id}
                onPress={() => pickWinner(seat._id)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    backgroundColor: rgba(seatColor, 0.1),
                    borderColor: rgba(seatColor, 0.55),
                    borderWidth: 1,
                    flexDirection: "row",
                    gap: 8,
                    paddingHorizontal: 10,
                  },
                  pressed && styles.btnPressed,
                  busy && styles.ctaDisabled,
                ]}
              >
                <Text style={styles.showdownName} numberOfLines={1}>
                  {seat.displayName}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

// Simple hex-to-rgba converter for dynamic seat-colored styling.
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// =============================================================================
// Helpers
// =============================================================================

function streetLabel(hand: Hand): string {
  switch (hand.street) {
    case "preflop":
      return "Preflop";
    case "flop":
      return "Flop";
    case "turn":
      return "Turn";
    case "river":
      return "River";
    case "showdown":
      return "Showdown";
    case "complete":
      return "Hand complete";
  }
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  topKicker: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  topSub: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 2,
  },
  endGameBtn: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingVertical: 4,
  },
  errorInline: {
    color: colors.danger,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 24,
    marginBottom: 6,
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
    top: TABLE_H / 2 - 60,
    alignItems: "center",
  },
  // Dark pill card that holds the total pot. Same height and visual language
  // as the per-seat bet chips so chips-out and pot-in read as one system.
  potCard: {
    height: BET_H,
    paddingHorizontal: 10,
    borderRadius: 8,
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
  // A dimmer, smaller pill below the Total — only shown when there are side
  // pots so the user can see the breakdown without opening the showdown dock.
  subPotCard: {
    height: BET_H - 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "rgba(11,20,16,0.85)",
    borderWidth: 1,
    borderColor: colors.hair,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  subPotText: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: -0.1,
    fontVariant: ["tabular-nums"],
  },
  cardRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 12,
  },
  cardBack: {
    width: COMMUNITY_CARD_W,
    height: COMMUNITY_CARD_H,
    borderRadius: 3,
    backgroundColor: colors.danger,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  cardSlot: {
    width: COMMUNITY_CARD_W,
    height: COMMUNITY_CARD_H,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.2)",
    borderStyle: "dashed",
  },
  streetLabel: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginTop: 8,
  },
  holeCards: {
    position: "absolute",
    height: HOLE_CARD_H,
    zIndex: 0,
  },
  holeCard: {
    position: "absolute",
    width: HOLE_CARD_W,
    height: HOLE_CARD_H,
    borderRadius: 3,
    backgroundColor: colors.danger,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  holeCardLeft: {
    left: 0,
    transform: [{ rotate: "-5deg" }],
  },
  holeCardRight: {
    right: 0,
    transform: [{ rotate: "5deg" }],
  },
  handSeatPill: {
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
  handSeatPillToAct: {
    borderColor: colors.gold,
    borderWidth: 2,
    shadowColor: colors.gold,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  handSeatPillFolded: {
    opacity: 0.4,
  },
  handSeatAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  handSeatAvatarText: {
    color: "rgba(0,0,0,0.75)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  handSeatStackRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  handSeatStack: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 13,
    color: colors.gold,
  },
  handDealerButton: {
    position: "absolute",
    width: DEALER_BTN_SIZE,
    height: DEALER_BTN_SIZE,
    borderRadius: DEALER_BTN_SIZE / 2,
    backgroundColor: colors.ivory,
    borderWidth: 1.5,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  handDealerButtonText: {
    color: colors.bg,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  handHostChip: {
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
  // Fixed-width anchor centered on the oval rail. The inner chip
  // shrink-wraps so there's no trailing whitespace — "1" and "999" both
  // look tight.
  betChipAnchor: {
    position: "absolute",
    width: BET_ANCHOR_W,
    height: BET_H,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  betChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(11,20,16,0.92)",
    borderWidth: 1,
    borderColor: colors.hairStrong,
  },
  betChipText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.2,
  },
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },
  dock: {
    padding: 16,
    paddingTop: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  dockMuted: {
    color: colors.mute,
    textAlign: "center",
    paddingVertical: 18,
    fontSize: 14,
  },
  turnDock: {
    marginHorizontal: 12,
    marginTop: 20,
    marginBottom: 16,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.25)",
    overflow: "hidden",
  },
  turnDockHeader: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    alignItems: "center",
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairStrong,
    marginBottom: 10,
  },
  turnDockHeaderText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  turnDockBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 6,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
  },
  actionBtnFold: {
    backgroundColor: "rgba(201,72,72,0.1)",
    borderWidth: 1,
    borderColor: "rgba(201,72,72,0.5)",
  },
  actionBtnTextFold: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  actionBtnCall: {
    backgroundColor: "rgba(90,168,120,0.1)",
    borderWidth: 1,
    borderColor: "rgba(90,168,120,0.5)",
  },
  actionBtnTextCall: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  actionBtnRaise: {
    backgroundColor: "rgba(201,169,97,0.1)",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.5)",
  },
  actionBtnTextRaise: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  // Disabled action button — neutral, dim, no accent color. Subtle enough
  // not to dominate, but clearly reads as "unavailable."
  actionBtnInactive: {
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  actionBtnTextInactive: {
    color: colors.mute,
    fontSize: 15,
    fontWeight: "700",
  },
  ctaDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.55 },
  error: {
    color: colors.danger,
    marginVertical: 8,
    textAlign: "center",
    fontSize: 14,
  },
  showdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  showdownName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.hairStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 22,
  },
  quickRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  quickBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.hairStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
