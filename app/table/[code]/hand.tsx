import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { colorHex, theme } from "@/lib/colors";
import { useDeviceId } from "@/lib/deviceId";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type SeatWithProfile = Doc<"seats"> & { displayName: string; color: string };
type Hand = Doc<"hands">;
type Action = Doc<"actions">;

// =============================================================================
// Screen
// =============================================================================

export default function HandScreen() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const deviceId = useDeviceId();

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
  const [startError, setStartError] = useState<string | null>(null);

  // Auto-route on table state changes.
  useEffect(() => {
    if (table?.status === "ended") {
      router.replace(`/table/${code}/settle`);
    } else if (table?.status === "lobby") {
      router.replace(`/table/${code}/lobby`);
    }
  }, [table?.status, code, router]);

  if (!table || !seats || handView === undefined || !deviceId) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const isHost = table.hostDeviceId === deviceId;
  const mySeat = seats.find((s) => s.deviceId === deviceId);
  const hand = handView?.hand;
  const actions = handView?.actions ?? [];
  const result = handView?.result;

  async function handleStartHand() {
    setStartError(null);
    try {
      await startHand({ deviceId: deviceId!, tableId: table!._id });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start hand");
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.code}>{table.code}</Text>
          <Text style={styles.streetLabel}>
            {hand ? streetLabel(hand) : "Between hands"}
          </Text>
        </View>

        <PotSection hand={hand} />

        <SeatsList
          seats={seats}
          hand={hand ?? null}
          actions={actions}
          hostDeviceId={table.hostDeviceId}
          mySeatId={mySeat?._id ?? null}
        />

        {startError ? <Text style={styles.error}>{startError}</Text> : null}
      </ScrollView>

      <ActionDock
        table={table}
        hand={hand ?? null}
        actions={actions}
        result={result ?? null}
        seats={seats}
        mySeat={mySeat ?? null}
        isHost={isHost}
        deviceId={deviceId}
        onStartHand={handleStartHand}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// Pot section
// =============================================================================

function PotSection({ hand }: { hand: Hand | undefined }) {
  return (
    <View style={styles.potBox}>
      <Text style={styles.potLabel}>Pot</Text>
      <Text style={styles.potValue}>{hand?.pot ?? 0}</Text>
      {hand && hand.currentBet > 0 ? (
        <Text style={styles.muted}>
          Current bet: {hand.currentBet}
        </Text>
      ) : null}
    </View>
  );
}

// =============================================================================
// Seats list — shows everyone with stacks, current commitment, status
// =============================================================================

function SeatsList({
  seats,
  hand,
  actions,
  hostDeviceId,
  mySeatId,
}: {
  seats: SeatWithProfile[];
  hand: Hand | null;
  actions: Action[];
  hostDeviceId: string;
  mySeatId: Id<"seats"> | null;
}) {
  // Per-seat commitment on the current street (excluding undone actions).
  const streetCommit = useMemo(() => {
    const map = new Map<Id<"seats">, number>();
    if (!hand) return map;
    const street = hand.street === "showdown" || hand.street === "complete"
      ? "river"
      : hand.street;
    for (const a of actions) {
      if (a.undone) continue;
      if (a.street !== street) continue;
      map.set(a.seatId, (map.get(a.seatId) ?? 0) + a.amount);
    }
    return map;
  }, [actions, hand]);

  const folded = useMemo(() => {
    const set = new Set<Id<"seats">>();
    for (const a of actions) {
      if (!a.undone && a.type === "fold") set.add(a.seatId);
    }
    return set;
  }, [actions]);

  return (
    <View style={styles.seatsList}>
      {seats.map((seat) => {
        const isMe = seat._id === mySeatId;
        const isHostSeat = seat.deviceId === hostDeviceId;
        const isToAct =
          hand?.toActSeatIndex !== undefined &&
          hand.toActSeatIndex === seat.seatIndex;
        const isDealer =
          hand !== null && hand.dealerSeatIndex === seat.seatIndex;
        const isFolded = folded.has(seat._id);
        const commit = streetCommit.get(seat._id) ?? 0;

        return (
          <View
            key={seat._id}
            style={[
              styles.seatRow,
              isToAct && styles.seatRowToAct,
              isFolded && styles.seatRowFolded,
            ]}
          >
            <View
              style={[styles.colorDot, { backgroundColor: colorHex(seat.color) }]}
            />
            <View style={styles.seatBody}>
              <View style={styles.seatNameRow}>
                <Text style={styles.seatName}>
                  {seat.displayName}
                  {isMe ? " (you)" : ""}
                </Text>
                {isHostSeat ? <Pill text="HOST" tone="warning" /> : null}
                {isDealer ? <Pill text="D" tone="muted" /> : null}
                {isToAct ? <Pill text="TO ACT" tone="accent" /> : null}
                {isFolded ? <Pill text="FOLD" tone="muted" /> : null}
              </View>
              <Text style={styles.seatStatus}>
                {seatLine(seat, commit)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function seatLine(seat: SeatWithProfile, commit: number): string {
  if (seat.status === "pending_buy_in") return "Awaiting buy-in";
  if (seat.status === "cashed_out") return "Cashed out";
  if (seat.status === "kicked") return "Removed";
  const stack = `${seat.chipStack} chips`;
  if (commit > 0) return `${stack}  ·  bet ${commit}`;
  if (seat.status === "sitting_out") return `${stack}  ·  sitting out`;
  return stack;
}

function Pill({
  text,
  tone,
}: {
  text: string;
  tone: "accent" | "warning" | "muted";
}) {
  const bg =
    tone === "accent"
      ? theme.accent
      : tone === "warning"
      ? theme.warning
      : theme.surfaceElevated;
  const fg = tone === "muted" ? theme.text : theme.bg;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
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
  deviceId,
  onStartHand,
}: {
  table: Doc<"tables">;
  hand: Hand | null;
  actions: Action[];
  result: Doc<"handResults"> | null;
  seats: SeatWithProfile[];
  mySeat: SeatWithProfile | null;
  isHost: boolean;
  deviceId: string;
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
        deviceId={deviceId}
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
        deviceId={deviceId}
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
  deviceId,
}: {
  table: Doc<"tables">;
  hand: Hand;
  actions: Action[];
  mySeat: SeatWithProfile;
  deviceId: string;
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
    try {
      await recordAction({
        deviceId,
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
    <View style={styles.dock}>
      <Text style={styles.dockHeader}>
        Your turn · stack {mySeat.chipStack}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actionRow}>
        <ActionButton
          label="Fold"
          tone="danger"
          onPress={() => fire("fold")}
          disabled={busy}
        />
        {canCheck ? (
          <ActionButton
            label="Check"
            onPress={() => fire("check")}
            disabled={busy}
          />
        ) : (
          <ActionButton
            label={`Call ${callAmount}`}
            tone="accent"
            onPress={() => fire("call")}
            disabled={busy || !canCall}
          />
        )}
        {canBet ? (
          <ActionButton
            label="Bet"
            tone="accent"
            onPress={() => setBetModal("bet")}
            disabled={busy}
          />
        ) : canRaise ? (
          <ActionButton
            label="Raise"
            tone="accent"
            onPress={() => setBetModal("raise")}
            disabled={busy}
          />
        ) : null}
        <ActionButton
          label="All-in"
          tone="warning"
          onPress={() => fire("all_in")}
          disabled={busy || mySeat.chipStack === 0}
        />
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
  tone?: "accent" | "danger" | "warning";
  disabled?: boolean;
}) {
  const bg =
    tone === "accent"
      ? theme.accent
      : tone === "danger"
      ? theme.danger
      : tone === "warning"
      ? theme.warning
      : theme.surface;
  const fg = tone ? theme.bg : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionBtn,
        { backgroundColor: bg },
        disabled && styles.ctaDisabled,
      ]}
    >
      <Text style={[styles.actionBtnText, { color: fg }]}>{label}</Text>
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
              <Text style={[styles.modalButtonText, { color: theme.text }]}>
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
  deviceId,
}: {
  hand: Hand;
  seats: SeatWithProfile[];
  deviceId: string;
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
      await awardPot({ deviceId, handId: hand._id, awards });
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
                  backgroundColor: isPicked ? colorHex(seat.color) : theme.surface,
                  borderColor: colorHex(seat.color),
                },
              ]}
            >
              <Text
                style={[
                  styles.showdownPillText,
                  { color: isPicked ? theme.bg : theme.text },
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
  container: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 16, paddingBottom: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 8,
  },
  code: { color: theme.textMuted, fontSize: 14, letterSpacing: 4 },
  streetLabel: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  potBox: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 24,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  potLabel: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  potValue: {
    color: theme.text,
    fontSize: 56,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    marginTop: 4,
  },
  muted: { color: theme.textMuted, fontSize: 14, marginTop: 4 },
  seatsList: { marginTop: 16 },
  seatRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  seatRowToAct: {
    borderColor: theme.accent,
    borderWidth: 2,
  },
  seatRowFolded: {
    opacity: 0.5,
  },
  colorDot: { width: 20, height: 20, borderRadius: 10 },
  seatBody: { flex: 1, marginLeft: 12 },
  seatNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  seatName: { color: theme.text, fontSize: 16, fontWeight: "600" },
  seatStatus: { color: theme.textMuted, fontSize: 13, marginTop: 2 },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  dock: {
    padding: 16,
    paddingTop: 12,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    backgroundColor: theme.bg,
  },
  dockHeader: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  dockMuted: {
    color: theme.textMuted,
    textAlign: "center",
    paddingVertical: 18,
    fontSize: 16,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: "30%",
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
  },
  actionBtnText: { fontWeight: "700", fontSize: 16 },
  cta: {
    backgroundColor: theme.accent,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: theme.bg, fontSize: 18, fontWeight: "700" },
  error: {
    color: theme.danger,
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
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "700" },
  modalSubtitle: { color: theme.textMuted, fontSize: 14, marginTop: 4 },
  modalInput: {
    backgroundColor: theme.surfaceElevated,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.text,
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
    borderColor: theme.border,
    borderWidth: 1,
  },
  modalConfirm: { backgroundColor: theme.accent },
  modalButtonText: { color: theme.bg, fontWeight: "700", fontSize: 16 },
});
