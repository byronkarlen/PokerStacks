import { Doc } from "@/convex/_generated/dataModel";
import { colors } from "@/theme";
import { StyleSheet, Text, View } from "react-native";
import {
  COMMUNITY_CARD_H,
  COMMUNITY_CARD_W,
  TABLE_H,
} from "../table/geometry";
import { PotCard, SidePotCard } from "../table/PotCard";
import { communityCardCount } from "./handHelpers";

type Hand = Doc<"hands">;

// Pot total + side-pot rows + 5 community-card slots + street label, all
// stacked vertically at the centre of the felt.
export function HandPotCenter({
  hand,
  bigBlind,
  displayedPot,
  pots,
  streetText,
}: {
  hand: Hand | undefined;
  bigBlind: number;
  // Pot value to display — usually `hand.pot`, but during the post-hand
  // transition we step through 0 → SB → SB+BB to animate the blinds posting.
  displayedPot: number;
  // Side-pot breakdown from getPotStructure. Only rendered when there's more
  // than one pot — main-pot only is already conveyed by the Total pill.
  pots: { index: number; amount: number }[] | undefined;
  streetText: string;
}) {
  const cardsRevealed = communityCardCount(hand?.street ?? "preflop");
  return (
    <View style={styles.center}>
      <PotCard>Total: {displayedPot / bigBlind}</PotCard>
      {pots && pots.length > 1
        ? pots.map((pot, i) => (
            <SidePotCard key={pot.index}>
              {i === 0 ? "Main pot" : "Side pot"}: {pot.amount / bigBlind}
            </SidePotCard>
          ))
        : null}
      <View style={styles.cardRow}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={i < cardsRevealed ? styles.cardBack : styles.cardSlot}
          />
        ))}
      </View>
      <Text style={styles.streetLabel}>{streetText.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: "absolute",
    left: 0,
    right: 0,
    top: TABLE_H / 2 - 60,
    alignItems: "center",
  },
  cardRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 12,
  },
  // Face-down community card — solid red (eventually a card-back graphic).
  cardBack: {
    width: COMMUNITY_CARD_W,
    height: COMMUNITY_CARD_H,
    borderRadius: 3,
    backgroundColor: colors.danger,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  // Empty slot — outlined dashed placeholder for cards yet to be revealed.
  cardSlot: {
    width: COMMUNITY_CARD_W,
    height: COMMUNITY_CARD_H,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.2)",
    borderStyle: "dashed",
  },
  streetLabel: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginTop: 8,
  },
});
