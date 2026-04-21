import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useUserId } from "@/hooks/useUserId";
import { colorHex, colors, typography } from "@/theme";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type SeatWithProfile = Doc<"seats"> & { displayName: string; color: string };
type Hand = Doc<"hands">;
type Action = Doc<"actions">;

// Oval-table geometry — mirrors the lobby screen so the table feels continuous
// across the two screens. "Me" is pinned to the bottom; other seats rotate
// around clockwise from there.
const TABLE_W = 340;
const TABLE_H = 440;
const SEAT_RX = 148;
const SEAT_RY = 200;
const PILL_W = 128;
const PILL_H = 48;

function seatPosition(index: number, total: number, meIndex: number) {
  const angle = ((index - meIndex) / total) * Math.PI * 2 + Math.PI / 2;
  const cx = TABLE_W / 2;
  const cy = TABLE_H / 2;
  return {
    left: cx + SEAT_RX * Math.cos(angle) - PILL_W / 2,
    top: cy + SEAT_RY * Math.sin(angle) - PILL_H / 2,
  };
}

// =============================================================================
// Screen
// =============================================================================

export default function HandScreen() {
  useKeepAwake();
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const userId = useUserId();

  const table = useQuery(api.tables.getByCode, { code });
  const seats = useQuery(
    api.tables.getSeatsWithProfile,
    table ? { tableId: table._id } : "skip",
  );
  const handView = useQuery(
    api.hands.getHandView,
    table ? { tableId: table._id } : "skip",
  );

  const startHand = useMutation(api.hands.startHand);
  const undoLastAction = useMutation(api.hands.undoLastAction);
  const [startError, setStartError] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [meMenuOpen, setMeMenuOpen] = useState(false);

  // Auto-route on table state changes.
  useEffect(() => {
    if (table?.status === "ended") {
      router.replace(`/table/${code}/settle`);
    } else if (table?.status === "lobby") {
      router.replace(`/table/${code}/lobby`);
    }
  }, [table?.status, code, router]);

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

  if (!table || !seats || handView === undefined || !userId) {
    return (
      <SafeAreaView style={[styles.container, styles.loading]}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  const isHost = table.hostUserId === userId;
  const mySeat = seats.find((s) => s.userId === userId);
  const hand = handView?.hand;
  const actions = handView?.actions ?? [];
  const result = handView?.result;

  async function handleStartHand() {
    setStartError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await startHand({ userId: userId!, tableId: table!._id });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start hand");
    }
  }

  async function handleUndo() {
    setUndoError(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {},
    );
    try {
      await undoLastAction({ userId: userId!, tableId: table!._id });
    } catch (e) {
      setUndoError(e instanceof Error ? e.message : "Undo failed");
    }
  }

  const meIndex = Math.max(
    0,
    seats.findIndex((s) => s.userId === userId),
  );
  const handNumber = hand?.handNumber;
  // SB/BB seats come from the posted-blind actions — empty until the first
  // hand's blinds post.
  const sbSeatId = actions.find(
    (a) => a.type === "post_sb" && !a.undone,
  )?.seatId;
  const bbSeatId = actions.find(
    (a) => a.type === "post_bb" && !a.undone,
  )?.seatId;
  const streetText = hand ? streetLabel(hand) : "Between hands";
  const toActSeat =
    hand?.toActSeatIndex !== undefined
      ? seats.find((s) => s.seatIndex === hand.toActSeatIndex)
      : undefined;
  const actionText =
    !hand || hand.voided
      ? "Waiting for host to deal"
      : hand.street === "complete"
      ? "Hand complete"
      : hand.street === "showdown"
      ? "Showdown"
      : mySeat && hand.toActSeatIndex === mySeat.seatIndex
      ? "Your turn"
      : `Waiting on ${toActSeat?.displayName ?? "…"}`;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Top bar */}
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
        <View style={styles.topBarRight}>
          <Pressable onPress={() => setMeMenuOpen(true)} hitSlop={8}>
            <Text style={styles.topMenuBtn}>Me</Text>
          </Pressable>
          {isHost ? (
            <Pressable
              onPress={() => router.push(`/table/${code}/settings`)}
              style={styles.topMenuIcon}
              hitSlop={8}
            >
              <Text style={styles.topMenuIconText}>≡</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {isHost && hand && !hand.voided && hand.street !== "complete" ? (
        <View style={styles.undoBar}>
          <Pressable onPress={handleUndo} hitSlop={8}>
            <Text style={styles.undoBarText}>Undo last action</Text>
          </Pressable>
          {undoError ? <Text style={styles.errorInline}>{undoError}</Text> : null}
        </View>
      ) : null}

      {/* Oval table with seats around it and pot in the center */}
      <View style={styles.tableWrap}>
        <View style={styles.tableArea}>
          <View style={styles.oval} />
          <View style={styles.potCenter}>
            <Text style={styles.potKicker}>Pot</Text>
            <Text style={styles.potValue}>{hand?.pot ?? 0}</Text>
            <Text style={styles.actionText}>{actionText}</Text>
          </View>
          {seats.map((seat, i) => (
            <HandSeatPill
              key={seat._id}
              seat={seat}
              isHostSeat={seat.userId === table.hostUserId}
              isMe={seat.userId === userId}
              isDealer={
                hand
                  ? hand.dealerSeatIndex === seat.seatIndex
                  : seat.seatIndex ===
                    (table.dealerSeatIndex < 0 ? 0 : table.dealerSeatIndex)
              }
              isSB={seat._id === sbSeatId}
              isBB={seat._id === bbSeatId}
              isToAct={
                hand?.toActSeatIndex !== undefined &&
                hand.toActSeatIndex === seat.seatIndex
              }
              isFolded={actions.some(
                (a) => !a.undone && a.type === "fold" && a.seatId === seat._id,
              )}
              bigBlind={table.bigBlind}
              position={seatPosition(i, seats.length, meIndex)}
            />
          ))}
        </View>
      </View>

      {startError ? <Text style={styles.errorInline}>{startError}</Text> : null}

      <ActionDock
        table={table}
        hand={hand ?? null}
        actions={actions}
        result={result ?? null}
        seats={seats}
        mySeat={mySeat ?? null}
        isHost={isHost}
        userId={userId}
        onStartHand={handleStartHand}
      />

      <MeMenu
        open={meMenuOpen}
        onClose={() => setMeMenuOpen(false)}
        mySeat={mySeat ?? null}
        tableId={table._id}
        userId={userId}
        isHost={isHost}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// HandSeatPill — seat rendering used on the oval table during a hand. Shows
// the "B" button on the dealer, a gold border on your seat, a subtle gold
// glow when it's their turn, and fades folded seats.
// =============================================================================

function HandSeatPill({
  seat,
  isHostSeat,
  isMe,
  isDealer,
  isSB,
  isBB,
  isToAct,
  isFolded,
  bigBlind,
  position,
}: {
  seat: SeatWithProfile;
  isHostSeat: boolean;
  isMe: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
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
          isMe && styles.handSeatPillMe,
          isToAct && styles.handSeatPillToAct,
          isFolded && styles.handSeatPillFolded,
        ]}
      >
        {isDealer ? (
          <View style={styles.handDealerButton}>
            <Text style={styles.handDealerButtonText}>B</Text>
          </View>
        ) : null}
        {isSB || isBB ? (
          <View style={styles.handPositionBadge}>
            <Text style={styles.handPositionBadgeText}>
              {isSB ? "SB" : "BB"}
            </Text>
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
        <View style={styles.handSeatInfo}>
          <Text style={styles.handSeatName} numberOfLines={1}>
            {isMe ? "Me" : seat.displayName}
            {isHostSeat ? (
              <Text style={styles.handSeatBadge}>  HOST</Text>
            ) : null}
          </Text>
          <Text style={styles.handSeatStack} numberOfLines={1}>
            {`${seat.chipStack / bigBlind} BB`}
          </Text>
        </View>
      </View>
      {isFolded ? <Text style={styles.handFoldedLabel}>FOLDED</Text> : null}
    </View>
  );
}

// =============================================================================
// MeMenu — sit out / sit in / cash out for the current player
// =============================================================================

function MeMenu({
  open,
  onClose,
  mySeat,
  tableId,
  userId,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  mySeat: SeatWithProfile | null;
  tableId: Id<"tables">;
  userId: Id<"users">;
  isHost: boolean;
}) {
  const router = useRouter();
  const sitOut = useMutation(api.tables.sitOut);
  const sitIn = useMutation(api.tables.sitIn);
  const cashOut = useMutation(api.tables.cashOut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !mySeat) return null;

  async function run<T>(fn: () => Promise<T>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>You · {mySeat.chipStack} chips</Text>

          {mySeat.status === "active" ? (
            <Pressable
              onPress={() => run(() => sitOut({ userId, tableId }))}
              disabled={busy}
              style={[styles.menuItem, busy && styles.ctaDisabled]}
            >
              <Text style={styles.menuItemText}>Sit out next hand</Text>
            </Pressable>
          ) : null}

          {mySeat.status === "sitting_out" ? (
            <Pressable
              onPress={() => run(() => sitIn({ userId, tableId }))}
              disabled={busy}
              style={[styles.menuItem, busy && styles.ctaDisabled]}
            >
              <Text style={styles.menuItemText}>Sit back in</Text>
            </Pressable>
          ) : null}

          {mySeat.status !== "cashed_out" && mySeat.status !== "kicked" ? (
            <Pressable
              onPress={() =>
                run(
                  () => cashOut({ userId, tableId }),
                  () => router.replace("/"),
                )
              }
              disabled={busy || isHost}
              style={[
                styles.menuItem,
                styles.menuItemDanger,
                (busy || isHost) && styles.ctaDisabled,
              ]}
            >
              <Text style={[styles.menuItemText, { color: colors.danger }]}>
                Cash out & leave
              </Text>
              {isHost ? (
                <Text style={styles.muted}>Transfer host first</Text>
              ) : null}
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={onClose}
            style={[styles.menuItem, { backgroundColor: "transparent" }]}
          >
            <Text style={[styles.menuItemText, { color: colors.mute }]}>
              Close
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// =============================================================================
// Action dock — bottom area: action buttons / showdown picker / next-hand
// =============================================================================

function ActionDock({
  table,
  hand,
  actions,
  result,
  seats,
  mySeat,
  isHost,
  userId,
  onStartHand,
}: {
  table: Doc<"tables">;
  hand: Hand | null;
  actions: Action[];
  result: Doc<"handResults"> | null;
  seats: SeatWithProfile[];
  mySeat: SeatWithProfile | null;
  isHost: boolean;
  userId: Id<"users">;
  onStartHand: () => void;
}) {
  // No hand in progress — host can deal, others wait.
  if (!hand || hand.street === "complete" || hand.voided) {
    return (
      <View style={styles.dock}>
        {isHost ? (
          <Pressable onPress={onStartHand} style={styles.cta}>
            <Text style={styles.ctaText}>Deal next hand</Text>
          </Pressable>
        ) : (
          <Text style={styles.dockMuted}>Waiting for host to deal…</Text>
        )}
      </View>
    );
  }

  // Showdown — anyone can pick the winner.
  if (hand.street === "showdown") {
    return (
      <ShowdownDock
        hand={hand}
        seats={seats}
        userId={userId}
      />
    );
  }

  // My turn? Show action buttons.
  if (mySeat && hand.toActSeatIndex === mySeat.seatIndex) {
    return (
      <MyTurnDock
        table={table}
        hand={hand}
        actions={actions}
        mySeat={mySeat}
        userId={userId}
      />
    );
  }

  // Otherwise — waiting on someone.
  const toAct = seats.find((s) => s.seatIndex === hand.toActSeatIndex);
  return (
    <View style={styles.dock}>
      <Text style={styles.dockMuted}>
        Waiting on {toAct?.displayName ?? "…"}
      </Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// MyTurnDock
// -----------------------------------------------------------------------------

function MyTurnDock({
  table,
  hand,
  actions,
  mySeat,
  userId,
}: {
  table: Doc<"tables">;
  hand: Hand;
  actions: Action[];
  mySeat: SeatWithProfile;
  userId: Id<"users">;
}) {
  const recordAction = useMutation(api.hands.recordAction);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [betModal, setBetModal] = useState<null | "bet" | "raise">(null);

  const myStreetCommit = useMemo(() => {
    const street =
      hand.street === "showdown" || hand.street === "complete"
        ? "river"
        : hand.street;
    let total = 0;
    for (const a of actions) {
      if (a.undone) continue;
      if (a.street !== street) continue;
      if (a.seatId !== mySeat._id) continue;
      total += a.amount;
    }
    return total;
  }, [actions, hand, mySeat]);

  const callAmount = Math.max(0, hand.currentBet - myStreetCommit);
  const canCheck = hand.currentBet === myStreetCommit;
  const canCall = !canCheck && callAmount > 0;
  const canBet = hand.currentBet === 0 && mySeat.chipStack >= table.bigBlind;
  const canRaise =
    hand.currentBet > 0 && mySeat.chipStack > callAmount;

  async function fire(
    type: "check" | "call" | "fold" | "all_in" | "bet" | "raise",
    amount?: number,
  ) {
    setError(null);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await recordAction({
        userId,
        handId: hand._id,
        type,
        amount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.myTurnDock}>
      <View style={styles.myTurnHeader}>
        <Text style={styles.myTurnKicker}>Your turn</Text>
        {hand.currentBet > 0 && callAmount > 0 ? (
          <Text style={styles.myTurnCall}>
            To call <Text style={styles.myTurnCallAmt}>{callAmount}</Text>
          </Text>
        ) : (
          <Text style={styles.myTurnCall}>
            Stack <Text style={styles.myTurnCallAmt}>{mySeat.chipStack}</Text>
          </Text>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actionRow}>
        <ActionButton
          label="Fold"
          tone="fold"
          onPress={() => fire("fold")}
          disabled={busy}
        />
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
        {canBet ? (
          <ActionButton
            label="Bet"
            tone="raise"
            onPress={() => setBetModal("bet")}
            disabled={busy}
          />
        ) : canRaise ? (
          <ActionButton
            label="Raise"
            tone="raise"
            onPress={() => setBetModal("raise")}
            disabled={busy}
          />
        ) : (
          <ActionButton
            label="All-in"
            tone="raise"
            onPress={() => fire("all_in")}
            disabled={busy || mySeat.chipStack === 0}
          />
        )}
      </View>

      <BetModal
        kind={betModal}
        onClose={() => setBetModal(null)}
        bigBlind={table.bigBlind}
        currentBet={hand.currentBet}
        minRaise={hand.minRaise}
        myStack={mySeat.chipStack}
        myStreetCommit={myStreetCommit}
        onConfirm={async (target) => {
          setBetModal(null);
          await fire(betModal === "bet" ? "bet" : "raise", target);
        }}
      />
    </View>
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
  const style =
    tone === "fold"
      ? styles.actionBtnFold
      : tone === "call"
      ? styles.actionBtnCall
      : styles.actionBtnRaise;
  const textStyle =
    tone === "fold"
      ? styles.actionBtnTextFold
      : tone === "call"
      ? styles.actionBtnTextCall
      : styles.actionBtnTextRaise;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionBtn, style, disabled && styles.ctaDisabled]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// BetModal — numeric input for bet/raise target
// -----------------------------------------------------------------------------

function BetModal({
  kind,
  onClose,
  onConfirm,
  bigBlind,
  currentBet,
  minRaise,
  myStack,
  myStreetCommit,
}: {
  kind: "bet" | "raise" | null;
  onClose: () => void;
  onConfirm: (target: number) => void | Promise<void>;
  bigBlind: number;
  currentBet: number;
  minRaise: number;
  myStack: number;
  myStreetCommit: number;
}) {
  const minTarget = kind === "bet" ? bigBlind : currentBet + minRaise;
  const maxTarget = myStreetCommit + myStack;
  const [target, setTarget] = useState(String(minTarget));

  useEffect(() => {
    setTarget(String(minTarget));
  }, [minTarget, kind]);

  if (!kind) return null;

  const numeric = Number(target);
  const valid =
    Number.isInteger(numeric) && numeric >= minTarget && numeric <= maxTarget;

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {kind === "bet" ? "Bet" : "Raise to"}
          </Text>
          <Text style={styles.modalSubtitle}>
            min {minTarget} · max {maxTarget}
          </Text>
          <TextInput
            value={target}
            onChangeText={setTarget}
            keyboardType="number-pad"
            style={styles.modalInput}
            autoFocus
          />
          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={[styles.modalButton, styles.modalCancel]}>
              <Text style={[styles.modalButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => valid && onConfirm(numeric)}
              disabled={!valid}
              style={[
                styles.modalButton,
                styles.modalConfirm,
                !valid && styles.ctaDisabled,
              ]}
            >
              <Text style={styles.modalButtonText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// ShowdownDock — pick winner(s)
// -----------------------------------------------------------------------------

function ShowdownDock({
  hand,
  seats,
  userId,
}: {
  hand: Hand;
  seats: SeatWithProfile[];
  userId: Id<"users">;
}) {
  const awardPot = useMutation(api.hands.awardPot);
  const potStructure = useQuery(api.hands.getPotStructure, { handId: hand._id });

  // Per-pot picked winners, indexed by potIndex.
  const [pickedByPot, setPickedByPot] = useState<
    Record<number, Set<Id<"seats">>>
  >({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!potStructure) {
    return (
      <View style={styles.dock}>
        <Text style={styles.dockMuted}>Loading pots…</Text>
      </View>
    );
  }

  const pots = potStructure.pots;
  const currentPot = pots[step];
  const isLast = step === pots.length - 1;

  function toggle(potIndex: number, seatId: Id<"seats">) {
    setPickedByPot((cur) => {
      const next = { ...cur };
      const set = new Set(next[potIndex] ?? []);
      if (set.has(seatId)) set.delete(seatId);
      else set.add(seatId);
      next[potIndex] = set;
      return next;
    });
  }

  function advance() {
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    submit();
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const awards: { seatId: Id<"seats">; potIndex: number; amount: number }[] = [];
      for (const pot of pots) {
        const winners = Array.from(pickedByPot[pot.index] ?? []);
        if (winners.length === 0) {
          throw new Error(`Pot ${pot.index + 1} needs a winner`);
        }
        const base = Math.floor(pot.amount / winners.length);
        const remainder = pot.amount - base * winners.length;
        winners.forEach((seatId, i) => {
          awards.push({
            seatId,
            potIndex: pot.index,
            amount: i < remainder ? base + 1 : base,
          });
        });
      }
      await awardPot({ userId, handId: hand._id, awards });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Award failed");
      setBusy(false);
    }
  }

  if (!currentPot) {
    return (
      <View style={styles.dock}>
        <Text style={styles.dockMuted}>No pot to award.</Text>
      </View>
    );
  }

  const eligible = currentPot.eligibleSeatIds
    .map((id) => seats.find((s) => s._id === id))
    .filter((s): s is SeatWithProfile => !!s);
  const picked = pickedByPot[currentPot.index] ?? new Set<Id<"seats">>();
  const potLabel =
    pots.length === 1
      ? "Who won?"
      : currentPot.isMain
      ? `Main pot (${step + 1}/${pots.length})`
      : `Side pot ${step + 1}/${pots.length}`;

  return (
    <View style={styles.dock}>
      <Text style={styles.dockHeader}>
        {potLabel} · {currentPot.amount} chips
      </Text>
      <View style={styles.showdownRow}>
        {eligible.map((seat) => {
          const isPicked = picked.has(seat._id);
          return (
            <Pressable
              key={seat._id}
              onPress={() => toggle(currentPot.index, seat._id)}
              style={[
                styles.showdownPill,
                {
                  backgroundColor: isPicked ? colorHex(seat.color) : colors.surface,
                  borderColor: colorHex(seat.color),
                },
              ]}
            >
              <Text
                style={[
                  styles.showdownPillText,
                  { color: isPicked ? colors.bg : colors.text },
                ]}
              >
                {seat.displayName}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={advance}
        disabled={picked.size === 0 || busy}
        style={[
          styles.cta,
          (picked.size === 0 || busy) && styles.ctaDisabled,
          { marginTop: 8 },
        ]}
      >
        <Text style={styles.ctaText}>
          {isLast
            ? picked.size > 1
              ? `Split & award all`
              : "Award all"
            : "Next pot"}
        </Text>
      </Pressable>
    </View>
  );
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
  // -------- Round 1 felt-palette shell --------
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
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
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  topMenuBtn: {
    color: colors.mute,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  topMenuIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hairStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  topMenuIconText: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 20,
  },
  undoBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingTop: 4,
    paddingBottom: 2,
  },
  undoBarText: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  errorInline: {
    color: "#d07070",
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
    left: (TABLE_W - 240) / 2,
    top: (TABLE_H - 340) / 2,
    width: 240,
    height: 340,
    borderRadius: 170,
    backgroundColor: "#1e3a2a",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.12)",
  },
  potCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    top: TABLE_H / 2 - 46,
    alignItems: "center",
  },
  potKicker: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  actionText: {
    color: colors.mute,
    fontSize: 12,
    marginTop: 6,
  },
  // Seat pill — reuses the lobby's visual language
  handSeatPill: {
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
  handSeatPillMe: {
    borderColor: colors.gold,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  handSeatAvatarText: {
    color: "rgba(0,0,0,0.75)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  handSeatInfo: { flex: 1, minWidth: 0 },
  handSeatName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  handSeatBadge: {
    color: colors.gold,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  handSeatStack: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 14,
    color: colors.gold,
    marginTop: 1,
  },
  handDealerButton: {
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
  handDealerButtonText: {
    color: colors.bg,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  handPositionBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "#4a7e99",
    zIndex: 2,
  },
  handPositionBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  handFoldedLabel: {
    color: colors.mute,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    textAlign: "center",
    marginTop: 4,
  },

  // -------- Existing styles (old theme-based — used by ActionDock, MeMenu, etc.) --------
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },
  scroll: { padding: 16, paddingBottom: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 8,
  },
  code: { color: colors.mute, fontSize: 14, letterSpacing: 4 },
  streetLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  potBox: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  potLabel: {
    color: colors.mute,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  potValue: {
    color: colors.text,
    fontSize: 56,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    marginTop: 4,
  },
  muted: { color: colors.mute, fontSize: 14, marginTop: 4 },
  seatsList: { marginTop: 16 },
  seatRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.hair,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  seatRowToAct: {
    borderColor: colors.gold,
    borderWidth: 2,
  },
  seatRowFolded: {
    opacity: 0.5,
  },
  colorDot: { width: 20, height: 20, borderRadius: 10 },
  seatBody: { flex: 1, marginLeft: 12 },
  seatNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  seatName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  seatStatus: { color: colors.mute, fontSize: 13, marginTop: 2 },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  dock: {
    padding: 16,
    paddingTop: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  dockHeader: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  dockMuted: {
    color: colors.mute,
    textAlign: "center",
    paddingVertical: 18,
    fontSize: 14,
  },
  myTurnDock: {
    marginHorizontal: 12,
    marginBottom: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.25)",
  },
  myTurnHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  myTurnKicker: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  myTurnCall: {
    color: colors.mute,
    fontSize: 12,
  },
  myTurnCallAmt: {
    color: colors.gold,
    fontWeight: "800",
    fontSize: 14,
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
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.2)",
  },
  actionBtnTextFold: {
    color: colors.mute,
    fontSize: 15,
    fontWeight: "700",
  },
  actionBtnCall: {
    backgroundColor: "#2a4a35",
    borderWidth: 1,
    borderColor: "#3a6049",
  },
  actionBtnTextCall: {
    color: colors.ivory,
    fontSize: 15,
    fontWeight: "700",
  },
  actionBtnRaise: {
    backgroundColor: colors.gold,
  },
  actionBtnTextRaise: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: "800",
  },
  cta: {
    backgroundColor: colors.gold,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.bg, fontSize: 18, fontWeight: "700" },
  error: {
    color: colors.danger,
    marginVertical: 8,
    textAlign: "center",
    fontSize: 14,
  },
  showdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 8,
    justifyContent: "center",
  },
  showdownPill: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    minHeight: 48,
  },
  showdownPillText: { fontSize: 16, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  modalSubtitle: { color: colors.mute, fontSize: 14, marginTop: 4 },
  modalInput: {
    backgroundColor: colors.raised,
    borderColor: colors.hair,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 16,
    textAlign: "center",
  },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 16 },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  modalCancel: {
    backgroundColor: "transparent",
    borderColor: colors.hair,
    borderWidth: 1,
  },
  modalConfirm: { backgroundColor: colors.gold },
  modalButtonText: { color: colors.bg, fontWeight: "700", fontSize: 16 },
  menuButton: { color: colors.text, fontSize: 18 },
  undoRow: {
    marginTop: 12,
    alignItems: "flex-end",
  },
  undoBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.gold,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  undoBtnText: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  menuItem: {
    backgroundColor: colors.raised,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginTop: 10,
    alignItems: "center",
  },
  menuItemDanger: {
    borderColor: colors.danger,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  menuItemText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
