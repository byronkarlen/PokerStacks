import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { colorHex, colors } from "@/theme";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { SeatWithProfile } from "../table/SeatPill";

type Hand = Doc<"hands">;

// Shown after the river when one or more pots need a winner picked. Anyone at
// the table can tap a player to award them the current pot — that's the
// agreed-upon protocol for honouring whatever the players showed each other
// in person. Server tracks `pendingAwards` so all clients advance through
// the pots in lockstep (main pot first, then any side pots).
export function ShowdownDock({
  hand,
  seats,
}: {
  hand: Hand;
  seats: SeatWithProfile[];
}) {
  const pickPotWinner = useMutation(api.hands.pickPotWinner);
  const potStructure = useQuery(api.hands.getPotStructure, {
    handId: hand._id,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!potStructure) {
    return (
      <DockShell headerText="Loading pots…">
        <View />
      </DockShell>
    );
  }

  const pots = potStructure.pots;
  // Step is derived from server state (count of awards already recorded), so
  // every client advances together as picks are made.
  const stepIndex = hand.pendingAwards?.length ?? 0;
  const currentPot = pots[stepIndex];

  if (!currentPot) {
    return (
      <DockShell headerText="No pot to award">
        <View />
      </DockShell>
    );
  }

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

  const eligibleSeats = currentPot.eligibleSeatIds
    .map((id) => seats.find((s) => s._id === id))
    .filter((s): s is SeatWithProfile => !!s);

  const headerText = stepIndex === 0 ? "Main Pot Winner" : "Side Pot Winner";

  return (
    <DockShell headerText={headerText}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        {eligibleSeats.map((seat) => (
          <SeatChoice
            key={seat._id}
            seat={seat}
            disabled={busy}
            onPress={() => pickWinner(seat._id)}
          />
        ))}
      </View>
    </DockShell>
  );
}

// One tappable choice per eligible seat — colored to match the seat avatar
// so visually identifying the right player is fast.
function SeatChoice({
  seat,
  disabled,
  onPress,
}: {
  seat: SeatWithProfile;
  disabled: boolean;
  onPress: () => void;
}) {
  const seatColor = colorHex(seat.color);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: rgba(seatColor, 0.1),
          borderColor: rgba(seatColor, 0.55),
        },
        pressed && styles.choicePressed,
        disabled && styles.choiceDisabled,
      ]}
    >
      <Text style={styles.choiceName} numberOfLines={1}>
        {seat.displayName}
      </Text>
    </Pressable>
  );
}

// Shared dock chrome: rounded panel, gold-on-dark header. Body slot below.
// Same visual frame the TurnDock uses (sans drag handle / body padding).
function DockShell({
  headerText,
  children,
}: {
  headerText: string;
  children: React.ReactNode;
}) {
  return (
    <Animated.View style={styles.dock} layout={LinearTransition}>
      <View style={styles.header}>
        <Text style={styles.headerText}>{headerText}</Text>
      </View>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

// Dynamic per-seat colors are easier to express against rgba() than against
// the theme alpha helpers, hence this small inline converter.
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  dock: {
    marginHorizontal: 12,
    marginTop: 20,
    marginBottom: 16,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.25)",
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    alignItems: "center",
  },
  headerText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  choice: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 10,
    minHeight: 60,
  },
  choicePressed: { opacity: 0.55 },
  choiceDisabled: { opacity: 0.4 },
  choiceName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  error: {
    color: colors.danger,
    marginVertical: 8,
    textAlign: "center",
    fontSize: 14,
  },
});
