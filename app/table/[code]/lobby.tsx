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

export default function Lobby() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const deviceId = useDeviceId();

  const table = useQuery(api.tables.getByCode, { code });
  const seats = useQuery(
    api.tables.getSeatsWithProfile,
    table ? { tableId: table._id } : "skip",
  );

  const startGame = useMutation(api.tables.startGame);

  // Auto-navigate to hand view once the host starts the game.
  useEffect(() => {
    if (table?.status === "active") {
      router.replace(`/table/${code}/hand`);
    } else if (table?.status === "ended") {
      router.replace(`/table/${code}/settle`);
    }
  }, [table?.status, code, router]);

  const [buyInTarget, setBuyInTarget] = useState<SeatWithProfile | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const isHost = !!table && !!deviceId && table.hostDeviceId === deviceId;
  const activeCount = useMemo(
    () => (seats ?? []).filter((s) => s.status === "active").length,
    [seats],
  );
  const canStart = isHost && activeCount >= 2;

  if (!table || !seats) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.subtitle}>Loading…</Text>
      </SafeAreaView>
    );
  }

  async function handleStart() {
    if (!deviceId || !table) return;
    setStartError(null);
    try {
      await startGame({ deviceId, tableId: table._id });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start");
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.label}>Table code</Text>
          <Text style={styles.code}>{table.code}</Text>
          <Text style={styles.hint}>
            Share this with your friends so they can join.
          </Text>
          {isHost ? (
            <Pressable
              onPress={() => router.push(`/table/${code}/settings`)}
              style={styles.settingsLink}
              hitSlop={8}
            >
              <Text style={styles.settingsLinkText}>Settings</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.label, { marginTop: 24 }]}>
          Seats ({activeCount} ready · {seats.length} total)
        </Text>

        {seats.map((seat) => (
          <SeatRow
            key={seat._id}
            seat={seat}
            isHostSeat={seat.deviceId === table.hostDeviceId}
            iAmHost={isHost}
            onBuyIn={() => setBuyInTarget(seat)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {startError ? <Text style={styles.error}>{startError}</Text> : null}
        {isHost ? (
          <Pressable
            onPress={handleStart}
            disabled={!canStart}
            style={[styles.cta, !canStart && styles.ctaDisabled]}
          >
            <Text style={styles.ctaText}>
              {activeCount < 2
                ? `Start game (${activeCount}/2 ready)`
                : "Start game"}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.waiting}>Waiting for host to start…</Text>
        )}
      </View>

      <BuyInModal
        seat={buyInTarget}
        defaultAmount={table.defaultBuyIn}
        onClose={() => setBuyInTarget(null)}
      />
    </SafeAreaView>
  );
}

function SeatRow({
  seat,
  isHostSeat,
  iAmHost,
  onBuyIn,
}: {
  seat: SeatWithProfile;
  isHostSeat: boolean;
  iAmHost: boolean;
  onBuyIn: () => void;
}) {
  const statusLabel = seatStatusLabel(seat);
  return (
    <View style={styles.seatRow}>
      <View style={[styles.colorDot, { backgroundColor: colorHex(seat.color) }]} />
      <View style={styles.seatBody}>
        <View style={styles.seatNameRow}>
          <Text style={styles.seatName}>{seat.displayName}</Text>
          {isHostSeat ? <Text style={styles.hostBadge}>HOST</Text> : null}
        </View>
        <Text style={styles.seatStatus}>{statusLabel}</Text>
      </View>
      {iAmHost && seat.status === "pending_buy_in" ? (
        <Pressable onPress={onBuyIn} style={styles.buyInButton}>
          <Text style={styles.buyInText}>Buy in</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function seatStatusLabel(seat: Doc<"seats">): string {
  switch (seat.status) {
    case "pending_buy_in":
      return "Awaiting buy-in";
    case "active":
      return `${seat.chipStack} chips`;
    case "sitting_out":
      return `${seat.chipStack} chips · sitting out`;
    case "cashed_out":
      return "Cashed out";
    case "kicked":
      return "Removed";
  }
}

function BuyInModal({
  seat,
  defaultAmount,
  onClose,
}: {
  seat: SeatWithProfile | null;
  defaultAmount: number;
  onClose: () => void;
}) {
  const deviceId = useDeviceId();
  const buyInSeat = useMutation(api.tables.buyInSeat);
  const [amount, setAmount] = useState(String(defaultAmount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when target changes.
  useEffect(() => {
    setAmount(String(defaultAmount));
    setError(null);
    setBusy(false);
  }, [seat, defaultAmount]);

  if (!seat) return null;

  const numeric = Number(amount);
  const valid = Number.isFinite(numeric) && numeric > 0 && Number.isInteger(numeric);

  async function handleConfirm() {
    if (!deviceId || !seat || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await buyInSeat({
        deviceId,
        seatId: seat._id as Id<"seats">,
        amount: numeric,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to buy in");
      setBusy(false);
    }
  }

  return (
    <Modal
      animationType="fade"
      transparent
      visible
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Buy in {seat.displayName}</Text>
          <Text style={styles.modalSubtitle}>
            They paid you — set the chip amount.
          </Text>

          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            style={styles.modalInput}
            autoFocus
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={[styles.modalButton, styles.modalCancel]}>
              <Text style={[styles.modalButtonText, { color: theme.text }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!valid || busy}
              style={[
                styles.modalButton,
                styles.modalConfirm,
                (!valid || busy) && styles.ctaDisabled,
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 24, paddingBottom: 32 },
  header: { alignItems: "center", paddingTop: 16 },
  label: {
    color: theme.textMuted,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  code: {
    color: theme.text,
    fontSize: 64,
    fontWeight: "800",
    letterSpacing: 12,
    fontVariant: ["tabular-nums"],
  },
  hint: {
    color: theme.textMuted,
    fontSize: 14,
    marginTop: 12,
    textAlign: "center",
  },
  settingsLink: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  settingsLinkText: {
    color: theme.textMuted,
    fontSize: 14,
    textDecorationLine: "underline",
  },
  subtitle: {
    color: theme.textMuted,
    fontSize: 16,
    textAlign: "center",
    marginTop: 32,
  },
  seatRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  colorDot: { width: 28, height: 28, borderRadius: 14 },
  seatBody: { flex: 1, marginLeft: 14 },
  seatNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  seatName: { color: theme.text, fontSize: 18, fontWeight: "600" },
  hostBadge: {
    color: theme.warning,
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: theme.surfaceElevated,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  seatStatus: { color: theme.textMuted, fontSize: 14, marginTop: 2 },
  buyInButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buyInText: { color: theme.bg, fontWeight: "700", fontSize: 14 },
  footer: {
    padding: 24,
    paddingTop: 12,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    backgroundColor: theme.bg,
  },
  cta: {
    backgroundColor: theme.accent,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: theme.bg, fontSize: 18, fontWeight: "700" },
  waiting: {
    color: theme.textMuted,
    textAlign: "center",
    fontSize: 16,
    paddingVertical: 18,
  },
  error: {
    color: theme.danger,
    marginBottom: 8,
    textAlign: "center",
    fontSize: 14,
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
