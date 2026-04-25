import { Id } from "@/convex/_generated/dataModel";
import { colors } from "@/theme";
import { useEffect, useRef } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SeatWithProfile } from "./SeatPill";
import { DEALER_BTN_SIZE, dealerButtonPosition } from "./geometry";

// Time the dealer button takes to slide between seats when the hand changes.
// Tuned so the slide reads as deliberate but doesn't slow the table down.
export const DEALER_BTN_SLIDE_MS = 500;

// Top-level dealer button rendered as a child of `tableArea`. When `handId`
// changes (a hand ended and the next one auto-started), the button slides
// from its old seat to its new seat. On first mount we snap into place — no
// animation, since there's no prior hand to transition from.
//
// Lobby use: pass `handId={undefined}` and a static `dealerSeatIndex`. The
// button just snaps to that seat and stays there.
export function DealerButton({
  seats,
  meIndex,
  dealerSeatIndex,
  handId,
}: {
  seats: SeatWithProfile[];
  meIndex: number;
  dealerSeatIndex: number;
  handId: Id<"hands"> | undefined;
}) {
  const dealerArrayIdx = Math.max(
    0,
    seats.findIndex((s) => s.seatIndex === dealerSeatIndex),
  );
  const target = dealerButtonPosition(dealerArrayIdx, seats.length, meIndex);

  const left = useSharedValue(target.left);
  const top = useSharedValue(target.top);

  // Tracks the last hand we saw so we only animate on actual hand transitions
  // (not on every render and not on first mount of the screen).
  const prevHandIdRef = useRef<Id<"hands"> | undefined>(handId);

  useEffect(() => {
    const isSameHand = prevHandIdRef.current === handId;
    if (isSameHand) {
      // Same hand still in flight — keep the position synced if anything
      // about the seat layout changed (e.g. seat re-sort), but don't animate.
      left.value = target.left;
      top.value = target.top;
      return;
    }

    const isFirstHandSeen = prevHandIdRef.current === undefined;
    if (isFirstHandSeen) {
      // First hand on this screen — snap, don't slide.
      left.value = target.left;
      top.value = target.top;
    } else {
      // Hand transitioned — slide to the new dealer seat.
      left.value = withTiming(target.left, { duration: DEALER_BTN_SLIDE_MS });
      top.value = withTiming(target.top, { duration: DEALER_BTN_SLIDE_MS });
    }
    prevHandIdRef.current = handId;
  }, [handId, target.left, target.top, left, top]);

  const animatedStyle = useAnimatedStyle(() => ({
    left: left.value,
    top: top.value,
  }));

  return (
    <Animated.View style={[styles.dealerButton, animatedStyle]}>
      <Text style={styles.dealerButtonText}>B</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // zIndex 5 keeps the button above seat pills and bet chips while it's in
  // transit between seats.
  dealerButton: {
    position: "absolute",
    width: DEALER_BTN_SIZE,
    height: DEALER_BTN_SIZE,
    borderRadius: DEALER_BTN_SIZE / 2,
    backgroundColor: colors.ivory,
    borderWidth: 1.5,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  dealerButtonText: {
    color: colors.bg,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
});
