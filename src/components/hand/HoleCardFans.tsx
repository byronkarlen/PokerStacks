import { Doc } from "@/convex/_generated/dataModel";
import { colors } from "@/theme";
import { StyleSheet, View } from "react-native";
import {
  HOLE_CARD_H,
  HOLE_CARD_W,
  PILL_W,
  seatPosition,
} from "../table/geometry";
import { SeatWithProfile } from "../table/SeatPill";

type Action = Doc<"actions">;
type Hand = Doc<"hands">;

// Two face-down cards fanned above each in-the-hand seat. We render them
// before (i.e. underneath) the seat pills so the pill overlaps the bottom
// edge of the cards, giving the "cards tucked behind" look.
//
// Skipped for folded seats and for inactive (busted/cashed-out) seats — both
// are out of the hand, so no cards.
export function HoleCardFans({
  seats,
  hand,
  actions,
  meIndex,
}: {
  seats: SeatWithProfile[];
  hand: Hand | undefined;
  actions: Action[];
  meIndex: number;
}) {
  if (!hand || hand.street === "complete") return null;

  return (
    <>
      {seats.map((seat, i) => {
        const hasFolded = actions.some(
          (a) => a.type === "fold" && a.seatId === seat._id,
        );
        if (hasFolded || seat.status === "inactive") return null;
        return (
          <Fan
            key={`hole-${seat._id}`}
            position={seatPosition(i, seats.length, meIndex)}
          />
        );
      })}
    </>
  );
}

// One pair of fanned cards centred above a seat pill. The cards are rotated
// ±5° and overlap horizontally so the two reads as a single hand.
function Fan({ position }: { position: { left: number; top: number } }) {
  // Wider than one card so the right card peeks out past the left.
  const fanWidth = HOLE_CARD_W + 14;
  return (
    <View
      style={[
        styles.fan,
        {
          width: fanWidth,
          left: position.left + PILL_W / 2 - fanWidth / 2,
          // Tuck ~4px behind the top edge of the pill.
          top: position.top - HOLE_CARD_H + 4,
        },
      ]}
    >
      <View style={[styles.card, styles.cardLeft]} />
      <View style={[styles.card, styles.cardRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fan: {
    position: "absolute",
    height: HOLE_CARD_H,
    zIndex: 0, // explicit: must sit below seat pills
  },
  card: {
    position: "absolute",
    width: HOLE_CARD_W,
    height: HOLE_CARD_H,
    borderRadius: 3,
    backgroundColor: colors.danger,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  cardLeft: {
    left: 0,
    transform: [{ rotate: "-5deg" }],
  },
  cardRight: {
    right: 0,
    transform: [{ rotate: "5deg" }],
  },
});
