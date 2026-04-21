import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useUserId } from "@/hooks/useUserId";
import { colorHex, colors } from "@/theme";
import { useMutation, useQuery } from "convex/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
type ModalKind = "rebuy" | "edit_stack" | "kick" | "make_host";

export default function Settings() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const userId = useUserId();

  const table = useQuery(api.tables.getByCode, { code });
  const seats = useQuery(
    api.tables.getSeatsWithProfile,
    table ? { tableId: table._id } : "skip",
  );

  const voidHand = useMutation(api.hands.voidHand);
  const endGame = useMutation(api.tables.endGame);

  const [actionTarget, setActionTarget] = useState<{
    seat: SeatWithProfile;
    kind: ModalKind;
  } | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [endingBusy, setEndingBusy] = useState(false);

  // If the game ends while we're here (from another path, or our own endGame
  // that already succeeded), bounce to settlement so the user isn't stranded
  // on a stale settings view and can't fire endGame a second time.
  useEffect(() => {
    if (table?.status === "ended") {
      router.replace(`/table/${code}/settle`);
    } else if (table?.status === "lobby") {
      router.replace(`/table/${code}/lobby`);
    }
  }, [table?.status, code, router]);

  if (!table || !seats || !userId) {
    return (
      <SafeAreaView style={[styles.container, styles.loading]}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  const isHost = table.hostUserId === userId;
  if (!isHost) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: "Settings" }} />
        <Text style={[styles.muted, { padding: 24 }]}>Host only.</Text>
      </SafeAreaView>
    );
  }

  async function handleVoid() {
    setVoidError(null);
    try {
      await voidHand({ userId: userId!, tableId: table!._id });
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : "Void failed");
    }
  }

  async function handleEndGame() {
    setEndError(null);
    setEndingBusy(true);
    try {
      await endGame({ userId: userId!, tableId: table!._id });
      router.replace(`/table/${code}/settle`);
    } catch (e) {
      setEndError(e instanceof Error ? e.message : "End-game failed");
      setEndingBusy(false);
    }
  }

  const handInProgress = !!table.currentHandId;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: "Settings" }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>Game</Text>

        {handInProgress ? (
          <Pressable onPress={handleVoid} style={[styles.dangerCard]}>
            <Text style={styles.dangerCardTitle}>Void current hand</Text>
            <Text style={styles.dangerCardSub}>
              Refunds all bets to their seats and discards the hand.
            </Text>
          </Pressable>
        ) : null}

        {voidError ? <Text style={styles.error}>{voidError}</Text> : null}

        <Pressable
          onPress={() => router.push(`/table/${code}/history`)}
          style={[styles.linkCard, { marginTop: 8 }]}
        >
          <Text style={styles.linkCardTitle}>Hand history</Text>
          <Text style={styles.dangerCardSub}>
            Review every hand played at this table.
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setEndConfirmOpen(true)}
          style={[styles.dangerCard, { marginTop: 8 }]}
        >
          <Text style={styles.dangerCardTitle}>End game</Text>
          <Text style={styles.dangerCardSub}>
            Cash out everyone at their current stack and go to settlement.
          </Text>
        </Pressable>

        <Text style={[styles.sectionLabel, { marginTop: 32 }]}>Players</Text>

        {seats.map((seat) => (
          <SeatCard
            key={seat._id}
            seat={seat}
            isHostSeat={seat.userId === table.hostUserId}
            handInProgress={handInProgress}
            onAction={(kind) => setActionTarget({ seat, kind })}
          />
        ))}
      </ScrollView>

      <ActionModal
        target={actionTarget}
        defaultBuyIn={table.defaultBuyIn}
        onClose={() => setActionTarget(null)}
      />

      <Modal
        animationType="fade"
        transparent
        visible={endConfirmOpen}
        onRequestClose={() => setEndConfirmOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>End game?</Text>
            <Text style={styles.modalSubtitle}>
              Everyone is cashed out at their current stack and the
              settlement screen opens. This can&apos;t be undone.
            </Text>
            {endError ? <Text style={styles.error}>{endError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setEndConfirmOpen(false)}
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleEndGame}
                disabled={endingBusy}
                style={[
                  styles.modalButton,
                  { backgroundColor: colors.danger },
                  endingBusy && styles.seatBtnDisabled,
                ]}
              >
                <Text style={styles.modalButtonText}>
                  {endingBusy ? "…" : "End game"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================================
// SeatCard — shows one seat with available host actions
// =============================================================================

function SeatCard({
  seat,
  isHostSeat,
  handInProgress,
  onAction,
}: {
  seat: SeatWithProfile;
  isHostSeat: boolean;
  handInProgress: boolean;
  onAction: (kind: ModalKind) => void;
}) {
  const removed = seat.status === "kicked" || seat.status === "cashed_out";
  const canRebuy =
    !handInProgress &&
    (seat.status === "active" || seat.status === "sitting_out");
  const canEdit = !removed;
  const canKick = !removed && !isHostSeat;
  const canPromote =
    !isHostSeat && (seat.status === "active" || seat.status === "sitting_out");

  return (
    <View style={styles.seatCard}>
      <View style={styles.seatHeader}>
        <View
          style={[styles.colorDot, { backgroundColor: colorHex(seat.color) }]}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.seatName}>
            {seat.displayName}
            {isHostSeat ? "  ·  HOST" : ""}
          </Text>
          <Text style={styles.muted}>
            {seat.chipStack} chips · {seat.status.replace("_", " ")}
          </Text>
        </View>
      </View>

      <View style={styles.seatActions}>
        <SeatBtn
          label="Rebuy"
          tone="accent"
          enabled={canRebuy}
          onPress={() => onAction("rebuy")}
        />
        <SeatBtn
          label="Edit chips"
          enabled={canEdit}
          onPress={() => onAction("edit_stack")}
        />
        <SeatBtn
          label="Make host"
          enabled={canPromote}
          onPress={() => onAction("make_host")}
        />
        <SeatBtn
          label="Remove"
          tone="danger"
          enabled={canKick}
          onPress={() => onAction("kick")}
        />
      </View>
    </View>
  );
}

function SeatBtn({
  label,
  enabled,
  onPress,
  tone,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
  tone?: "accent" | "danger";
}) {
  const bg =
    tone === "accent"
      ? colors.gold
      : tone === "danger"
      ? colors.danger
      : colors.raised;
  const fg = tone ? colors.bg : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      style={[
        styles.seatBtn,
        { backgroundColor: bg },
        !enabled && styles.seatBtnDisabled,
      ]}
    >
      <Text style={[styles.seatBtnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

// =============================================================================
// ActionModal — input for rebuy / edit / kick / make_host
// =============================================================================

function ActionModal({
  target,
  defaultBuyIn,
  onClose,
}: {
  target: { seat: SeatWithProfile; kind: ModalKind } | null;
  defaultBuyIn: number;
  onClose: () => void;
}) {
  const userId = useUserId();
  const rebuySeat = useMutation(api.tables.rebuySeat);
  const editStack = useMutation(api.tables.editStack);
  const kickPlayer = useMutation(api.tables.kickPlayer);
  const transferHost = useMutation(api.tables.transferHost);

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  // Reset form when target changes.
  // (We rely on remount via key on Modal child; easier: parent unmounts via null target.)

  async function go() {
    if (!userId || !target) return;
    setBusy(true);
    setError(null);
    try {
      switch (target.kind) {
        case "rebuy": {
          const n = Number(amount);
          if (!Number.isInteger(n) || n <= 0) throw new Error("Enter a positive whole number");
          await rebuySeat({
            userId,
            seatId: target.seat._id as Id<"seats">,
            amount: n,
          });
          break;
        }
        case "edit_stack": {
          const n = Number(amount);
          if (!Number.isInteger(n) || n < 0) throw new Error("Enter zero or a positive number");
          await editStack({
            userId,
            seatId: target.seat._id as Id<"seats">,
            newAmount: n,
          });
          break;
        }
        case "kick": {
          await kickPlayer({
            userId,
            seatId: target.seat._id as Id<"seats">,
          });
          break;
        }
        case "make_host": {
          await transferHost({
            userId,
            toSeatId: target.seat._id as Id<"seats">,
          });
          break;
        }
      }
      onClose();
      setAmount("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const title = (() => {
    switch (target.kind) {
      case "rebuy":
        return `Rebuy ${target.seat.displayName}`;
      case "edit_stack":
        return `Edit ${target.seat.displayName}'s chips`;
      case "kick":
        return `Remove ${target.seat.displayName}?`;
      case "make_host":
        return `Make ${target.seat.displayName} the host?`;
    }
  })();

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>

          {target.kind === "rebuy" ? (
            <>
              <Text style={styles.modalSubtitle}>
                Add chips after they pay you. Default {defaultBuyIn}.
              </Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={String(defaultBuyIn)}
                placeholderTextColor={colors.mute}
                keyboardType="number-pad"
                style={styles.modalInput}
                autoFocus
              />
            </>
          ) : null}

          {target.kind === "edit_stack" ? (
            <>
              <Text style={styles.modalSubtitle}>
                Set their stack to a new value. Currently {target.seat.chipStack}.
              </Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={String(target.seat.chipStack)}
                placeholderTextColor={colors.mute}
                keyboardType="number-pad"
                style={styles.modalInput}
                autoFocus
              />
            </>
          ) : null}

          {target.kind === "kick" ? (
            <Text style={styles.modalSubtitle}>
              Their {target.seat.chipStack} chips will settle as a cash-out.
            </Text>
          ) : null}

          {target.kind === "make_host" ? (
            <Text style={styles.modalSubtitle}>
              You&apos;ll lose host privileges; they&apos;ll gain them.
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={onClose}
              style={[styles.modalButton, styles.modalCancel]}
            >
              <Text style={[styles.modalButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={go}
              disabled={busy}
              style={[
                styles.modalButton,
                styles.modalConfirm,
                target.kind === "kick" && { backgroundColor: colors.danger },
                busy && styles.seatBtnDisabled,
              ]}
            >
              <Text style={styles.modalButtonText}>
                {busy ? "…" : "Confirm"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { justifyContent: "center", alignItems: "center" },
  scroll: { padding: 16, paddingBottom: 32 },
  muted: { color: colors.mute, fontSize: 14 },
  sectionLabel: {
    color: colors.mute,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 8,
  },
  dangerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  dangerCardTitle: { color: colors.danger, fontSize: 16, fontWeight: "700" },
  dangerCardSub: { color: colors.mute, fontSize: 13, marginTop: 4 },
  linkCard: {
    backgroundColor: colors.surface,
    borderColor: colors.hair,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  linkCardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  seatCard: {
    backgroundColor: colors.surface,
    borderColor: colors.hair,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  seatHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  colorDot: { width: 24, height: 24, borderRadius: 12 },
  seatName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  seatActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  seatBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    minHeight: 40,
    justifyContent: "center",
  },
  seatBtnDisabled: { opacity: 0.35 },
  seatBtnText: { fontSize: 14, fontWeight: "600" },
  error: {
    color: colors.danger,
    marginTop: 8,
    textAlign: "center",
    fontSize: 13,
  },
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
  modalSubtitle: { color: colors.mute, fontSize: 14, marginTop: 8 },
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
    marginTop: 12,
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
});
