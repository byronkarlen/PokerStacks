import { Doc } from "@/convex/_generated/dataModel";
import { colors } from "@/theme";
import { StyleSheet, Text, View } from "react-native";
import { SeatWithProfile } from "../table/SeatPill";
import { ShowdownDock } from "./ShowdownDock";
import { TurnDock } from "./TurnDock";

type Hand = Doc<"hands">;
type Action = Doc<"actions">;

// Bottom dock dispatcher. Picks the right dock for the current hand state:
//
//   no hand / hand complete  → "Waiting for next hand…" placeholder
//   street === "showdown"    → ShowdownDock (pick the pot winner)
//   otherwise                → TurnDock (action buttons + bet sizer)
export function ActionDock({
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
  if (!hand || hand.street === "complete") {
    return <WaitingDock />;
  }

  if (hand.street === "showdown") {
    return <ShowdownDock hand={hand} seats={seats} />;
  }

  const toActSeat =
    hand.toActSeatIndex !== undefined
      ? seats.find((s) => s.seatIndex === hand.toActSeatIndex)
      : undefined;
  if (!toActSeat) {
    // toActSeatIndex undefined or unmatched — defensive fallback while the
    // server is mid-write between streets.
    return <WaitingDock />;
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

function WaitingDock() {
  return (
    <View style={styles.dock}>
      <Text style={styles.muted}>Waiting for next hand…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    padding: 16,
    paddingTop: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  muted: {
    color: colors.mute,
    textAlign: "center",
    paddingVertical: 18,
    fontSize: 14,
  },
});
