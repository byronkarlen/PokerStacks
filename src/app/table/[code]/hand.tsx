import { ActionDock } from "@/components/hand/ActionDock";
import { HandPotCenter } from "@/components/hand/HandPotCenter";
import { HandTopBar } from "@/components/hand/HandTopBar";
import { HoleCardFans } from "@/components/hand/HoleCardFans";
import { streetLabel } from "@/components/hand/handHelpers";
import {
  BB_DELAY_MS,
  SB_DELAY_MS,
  useHandTransitionAnimation,
} from "@/components/hand/useHandTransitionAnimation";
import { BetChip } from "@/components/table/BetChip";
import { DealerButton } from "@/components/table/DealerButton";
import { OvalFelt } from "@/components/table/OvalFelt";
import { SeatPill } from "@/components/table/SeatPill";
import { betPosition, seatPosition } from "@/components/table/geometry";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useMe } from "@/hooks/useMe";
import { colors } from "@/theme";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Hand = Doc<"hands">;
type Action = Doc<"actions">;

// =============================================================================
// HandScreen
// =============================================================================
//
// Live-hand view: oval table with seats, dealer button, hole cards, community
// cards and a per-hand action dock. Subscribes to the active hand via Convex
// queries; mutations live in the dock. The screen itself owns:
//   - route gating (auto-redirect when the table state changes)
//   - host-only auto-start of the very first hand
//   - the hand-transition animation timeline (dealer button slides + blinds
//     pop in) via useHandTransitionAnimation
//   - small bits of derived state (chips committed this street, displayed
//     pot during the transition)
//
// Most visual building blocks live under @/components/table (shared with the
// lobby) and @/components/hand (hand-specific).

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
  // Pot breakdown — only relevant when there's more than one pot (i.e. side
  // pots from all-ins). The Total pill covers the common case on its own.
  const potStructure = useQuery(
    api.hands.getPotStructure,
    handView?.hand ? { handId: handView.hand._id } : "skip",
  );

  const startHand = useMutation(api.hands.startHand);
  const endGame = useMutation(api.games.endGame);
  const undoLastAction = useMutation(api.hands.undoLastAction);
  const [endError, setEndError] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  useTableLifecycleRouting(table?.status, code, router);
  useFirstHandAutoStart({ table, userId, startHand });
  useTurnAndCompletionHaptics(handView, seats, userId);

  // Drives the post-hand transition animation (dealer slide → SB pop → BB
  // pop). `phase` controls what the table renders during those ~1.5s.
  const { phase: animPhase, isTransitioning } = useHandTransitionAnimation(
    handView?.hand?._id,
  );

  if (!table || !seats || handView === undefined || !userId) {
    return (
      <SafeAreaView style={[styles.container, styles.loading]}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  const mySeat = seats.find((s) => s.userId === userId) ?? null;
  const hand = handView?.hand ?? null;
  const actions = handView?.actions ?? [];
  const isHost = table.hostUserId === userId;

  const meIndex = Math.max(
    0,
    seats.findIndex((s) => s.userId === userId),
  );

  // Chips each seat has put in on the CURRENT betting street. Cleared when
  // the street advances (actions from prior streets don't match) — mirrors
  // what live tables do when chips get swept into the pot between streets.
  const chipsByStreet = chipsCommittedThisStreet(hand, actions);

  // SB/BB seats and amounts on the current hand. Used to drive the staggered
  // chip pop-ins and the displayed pot during the transition.
  const sbAction = actions.find((a) => a.type === "post_sb");
  const bbAction = actions.find((a) => a.type === "post_bb");
  const sbSeatId = sbAction?.seatId;
  const bbSeatId = bbAction?.seatId;
  const sbAmount = sbAction?.amount ?? 0;
  const bbAmount = bbAction?.amount ?? 0;

  // Pot total to display. During the post-hand transition we step it up
  // (0 → SB → SB+BB) so the user can see each blind being posted.
  const displayedPot = computeDisplayedPot({
    hand,
    phase: animPhase,
    sbAmount,
    bbAmount,
  });

  const streetText = hand ? streetLabel(hand) : "Between hands";

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

  async function handleUndo() {
    setUndoError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await undoLastAction({ gameId: table!._id });
    } catch (e) {
      setUndoError(e instanceof Error ? e.message : "Failed to undo");
    }
  }

  // Dealer button position. Before the first hand starts the table stores
  // -1; hands.ts treats that as seat 0 (the host), so we display it there.
  const dealerSeatIndex = hand
    ? hand.dealerSeatIndex
    : table.dealerSeatIndex < 0
      ? 0
      : table.dealerSeatIndex;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <HandTopBar
        table={table}
        handNumber={hand?.handNumber}
        streetText={streetText}
        isHost={isHost}
        onUndo={handleUndo}
        onEndGame={handleEndGame}
      />
      {endError ? <Text style={styles.errorInline}>{endError}</Text> : null}
      {undoError ? <Text style={styles.errorInline}>{undoError}</Text> : null}

      <View style={styles.tableWrap}>
        <OvalFelt>
          <HandPotCenter
            hand={hand ?? undefined}
            bigBlind={table.bigBlind}
            displayedPot={displayedPot}
            pots={potStructure?.pots}
            streetText={streetText}
          />

          <HoleCardFans
            seats={seats}
            hand={hand ?? undefined}
            actions={actions}
            meIndex={meIndex}
          />

          {seats.map((seat, i) => (
            <SeatPill
              key={seat._id}
              seat={seat}
              isHostSeat={seat.userId === table.hostUserId}
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
            dealerSeatIndex={dealerSeatIndex}
            handId={hand?._id}
          />

          {seats.map((seat, i) => {
            const amount = chipsByStreet.get(seat._id) ?? 0;
            if (amount === 0) return null;

            // SB/BB chips on a fresh hand pop in *after* the dealer button
            // has finished sliding. Other chips (player bets later in the
            // hand) pop in immediately on first appearance.
            const enteringDelayMs =
              isTransitioning && seat._id === sbSeatId
                ? SB_DELAY_MS
                : isTransitioning && seat._id === bbSeatId
                  ? BB_DELAY_MS
                  : 0;

            return (
              <BetChip
                // Key includes hand id and street so the chip remounts (and
                // re-runs its pop animation) when a player first contributes
                // on a new street, not just on a new hand.
                key={`bet-${hand?._id}-${hand?.street}-${seat._id}`}
                amount={amount}
                position={betPosition(i, seats.length, meIndex)}
                enteringDelayMs={enteringDelayMs}
              />
            );
          })}
        </OvalFelt>
      </View>

      <ActionDock
        table={table}
        hand={hand}
        actions={actions}
        seats={seats}
        mySeat={mySeat}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// Pure derivations
// =============================================================================

// Sum of chips each seat has committed on the current betting street. Empty
// during showdown/complete (no current betting street).
function chipsCommittedThisStreet(
  hand: Hand | null,
  actions: Action[],
): Map<Id<"seats">, number> {
  const out = new Map<Id<"seats">, number>();
  if (!hand) return out;
  if (
    hand.street !== "preflop" &&
    hand.street !== "flop" &&
    hand.street !== "turn" &&
    hand.street !== "river"
  ) {
    return out;
  }
  for (const a of actions) {
    if (a.street !== hand.street) continue;
    out.set(a.seatId, (out.get(a.seatId) ?? 0) + a.amount);
  }
  return out;
}

// Pot value to show on the felt. During the post-hand transition we step
// through 0 → SB → SB+BB so the user can see each blind being posted; once
// the transition finishes we just mirror `hand.pot`.
function computeDisplayedPot({
  hand,
  phase,
  sbAmount,
  bbAmount,
}: {
  hand: Hand | null;
  phase: "dealer" | "sb" | "bb" | "done";
  sbAmount: number;
  bbAmount: number;
}): number {
  if (!hand) return 0;
  switch (phase) {
    case "dealer":
      return 0;
    case "sb":
      return sbAmount;
    case "bb":
      return sbAmount + bbAmount;
    case "done":
      return hand.pot;
  }
}

// =============================================================================
// Effects
// =============================================================================

// Auto-redirect off the hand screen when the table moves to ended or back to
// lobby. Not all clients press "End game" themselves — they need to follow.
function useTableLifecycleRouting(
  status: Doc<"games">["status"] | undefined,
  code: string,
  router: ReturnType<typeof useRouter>,
) {
  useEffect(() => {
    if (status === "ended") {
      router.replace(`/table/${code}/settle`);
    } else if (status === "lobby") {
      router.replace(`/table/${code}/lobby`);
    }
  }, [status, code, router]);
}

// Host-only: auto-start the very first hand once we land on the screen with
// no current hand in flight. Subsequent hands auto-start on the server after
// pickPotWinner (or the single-survivor branch) finalizes the prior hand.
function useFirstHandAutoStart({
  table,
  userId,
  startHand,
}: {
  table: Doc<"games"> | null | undefined;
  userId: Id<"users"> | undefined;
  startHand: ReturnType<
    typeof useMutation<typeof api.hands.startHand>
  >;
}) {
  const startedRef = useRef(false);
  const isHost = !!userId && table?.hostUserId === userId;

  useEffect(() => {
    if (
      isHost &&
      table?.status === "active" &&
      table?.currentHandId === undefined &&
      !startedRef.current
    ) {
      startedRef.current = true;
      startHand({ gameId: table._id }).catch(() => {
        // Probably <2 seats with chips. Reset so the host can try later
        // (e.g. once another player buys back in).
        startedRef.current = false;
      });
    }
  }, [isHost, table?.status, table?.currentHandId, table?._id, startHand]);
}

// Two haptics:
//   - Warning bump when it becomes the local player's turn
//   - Success bump when a hand completes (a winner has been picked)
function useTurnAndCompletionHaptics(
  handView: { hand: Hand | null; actions: Action[] } | null | undefined,
  seats:
    | { userId: Id<"users">; seatIndex: number }[]
    | undefined,
  userId: Id<"users"> | undefined,
) {
  const lastToActRef = useRef<number | undefined>(undefined);
  const lastStreetRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const hand = handView?.hand ?? null;
    const mySeatIndex =
      handView && userId
        ? seats?.find((s) => s.userId === userId)?.seatIndex
        : undefined;

    const newToAct = hand?.toActSeatIndex;
    if (
      newToAct !== undefined &&
      newToAct === mySeatIndex &&
      lastToActRef.current !== newToAct
    ) {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Warning,
      ).catch(() => {});
    }
    lastToActRef.current = newToAct;

    const newStreet = hand?.street;
    if (
      newStreet === "complete" &&
      lastStreetRef.current !== "complete" &&
      lastStreetRef.current !== undefined
    ) {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    }
    lastStreetRef.current = newStreet;
  }, [handView, seats, userId]);
}

// =============================================================================
// Styles (screen-level only — most styling lives in the components above)
// =============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },
  tableWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorInline: {
    color: colors.danger,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 24,
    marginBottom: 6,
  },
});
