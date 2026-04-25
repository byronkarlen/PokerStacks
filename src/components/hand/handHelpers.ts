import { Doc } from "@/convex/_generated/dataModel";

type Hand = Doc<"hands">;

// Number of community cards visible at the given street.
//   preflop = 0, flop = 3, turn = 4, river/showdown/complete = 5
export function communityCardCount(street: Hand["street"]): number {
  if (street === "preflop") return 0;
  if (street === "flop") return 3;
  if (street === "turn") return 4;
  return 5;
}

// Title-cased label for the current street, used in the top bar and the
// "STREET" label under the community cards.
export function streetLabel(hand: Hand): string {
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
