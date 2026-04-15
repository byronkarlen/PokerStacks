import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { colorHex, theme } from "@/lib/colors";
import { useDeviceId } from "@/lib/deviceId";
import { useMutation, useQuery } from "convex/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
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
type ModalKind = "rebuy" | "edit_stack" | "kick" | "make_host";

export default function Settings() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const deviceId = useDeviceId();

  const table = useQuery(api.tables.getByCode, { code });
  const seats = useQuery(
    api.tables.getSeatsWithProfile,
    table ? { tableId: table._id } : "skip",
  );

  const voidHand = useMutation(api.hands.voidHand);

  const [actionTarget, setActionTarget] = useState<{
    seat: SeatWithProfile;
    kind: ModalKind;
  } | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);

  if (!table || !seats || !deviceId) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const isHost = table.hostDeviceId === deviceId;
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
      await voidHand({ deviceId: deviceId!, tableId: table!._id });
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : "Void failed");
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
          onPress={() => router.push(`/table/${code}/end`)}
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
            isHostSeat={seat.deviceId === table.hostDeviceId}
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
      ? theme.accent
      : tone === "danger"
      ? theme.danger
      : theme.surfaceElevated;
  const fg = tone ? theme.bg : theme.text;
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
  const deviceId = useDeviceId();
  const rebuySeat = useMutation(api.tables.rebuySeat);
  const editStack = useMutation(api.tables.editStack);
  const kickPlayer = useMutation(api.tables.kickPlayer);
  const transferHost = useMutation(api.tables.transferHost);

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  // Reset form when target changes.
  // (We rely on remount via key on Modal child; easier: parent unmounts via null target.)

  async function go() {
    if (!deviceId || !target) return;
    setBusy(true);
    setError(null);
    try {
      switch (target.kind) {
        case "rebuy": {
          const n = Number(amount);
          if (!Number.isInteger(n) || n <= 0) throw new Error("Enter a positive whole number");
          await rebuySeat({
            deviceId,
            seatId: target.seat._id as Id<"seats">,
            amount: n,
          });
          break;
        }
        case "edit_stack": {
          const n = Number(amount);
          if (!Number.isInteger(n) || n < 0) throw new Error("Enter zero or a positive number");
          if (reason.trim().length === 0) throw new Error("Reason required");
          await editStack({
            deviceId,
            seatId: target.seat._id as Id<"seats">,
            newAmount: n,
            reason: reason.trim(),
          });
          break;
        }
        case "kick": {
          await kickPlayer({
            deviceId,
            seatId: target.seat._id as Id<"seats">,
          });
          break;
        }
        case "make_host": {
          await transferHost({
            deviceId,
            toSeatId: target.seat._id as Id<"seats">,
          });
          break;
        }
      }
      onClose();
      setAmount("");
      setReason("");
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
                placeholderTextColor={theme.textMuted}
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
                placeholderTextColor={theme.textMuted}
                keyboardType="number-pad"
                style={styles.modalInput}
                autoFocus
              />
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Reason (required)"
                placeholderTextColor={theme.textMuted}
                style={[styles.modalInput, { fontSize: 16, fontWeight: "400", textAlign: "left" }]}
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
              You'll lose host privileges; they'll gain them.
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={onClose}
              style={[styles.modalButton, styles.modalCancel]}
            >
              <Text style={[styles.modalButtonText, { color: theme.text }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={go}
              disabled={busy}
              style={[
                styles.modalButton,
                styles.modalConfirm,
                target.kind === "kick" && { backgroundColor: theme.danger },
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
  container: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 16, paddingBottom: 32 },
  muted: { color: theme.textMuted, fontSize: 14 },
  sectionLabel: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 8,
  },
  dangerCard: {
    backgroundColor: theme.surface,
    borderColor: theme.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  dangerCardTitle: { color: theme.danger, fontSize: 16, fontWeight: "700" },
  dangerCardSub: { color: theme.textMuted, fontSize: 13, marginTop: 4 },
  seatCard: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  seatHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  colorDot: { width: 24, height: 24, borderRadius: 12 },
  seatName: { color: theme.text, fontSize: 16, fontWeight: "600" },
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
    color: theme.danger,
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
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "700" },
  modalSubtitle: { color: theme.textMuted, fontSize: 14, marginTop: 8 },
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
    borderColor: theme.border,
    borderWidth: 1,
  },
  modalConfirm: { backgroundColor: theme.accent },
  modalButtonText: { color: theme.bg, fontWeight: "700", fontSize: 16 },
});
