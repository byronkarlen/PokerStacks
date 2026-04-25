import { Id } from "@/convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";
import { DEALER_BTN_SLIDE_MS } from "../table/DealerButton";

// Choreography for "the previous hand just ended, the next one is starting":
//   1. Dealer button slides to its new seat       (DEALER_BTN_SLIDE_MS)
//   2. Brief beat                                 (~200ms)
//   3. SB chip pops in, displayed pot = SB        (at SB_DELAY_MS)
//   4. Brief beat                                 (~120ms)
//   5. BB chip pops in, displayed pot = SB+BB     (at BB_DELAY_MS)
//   6. Done — table returns to its normal state   (at TOTAL_MS)
//
// The delays are absolute milliseconds from the start of the transition.
export const SB_DELAY_MS = DEALER_BTN_SLIDE_MS + 200;
export const BB_DELAY_MS = SB_DELAY_MS + 400;
export const TRANSITION_TOTAL_MS = BB_DELAY_MS + 400;

export type HandTransitionPhase = "dealer" | "sb" | "bb" | "done";

export type HandTransitionAnimation = {
  // The phase the table should display *right now*. Driven by setTimeouts
  // after the hand changes, plus a synchronous override on the very first
  // render with a new hand id so child components (e.g. BetChip) can attach
  // their entering animations on first mount.
  phase: HandTransitionPhase;
  // Convenience flag: anything other than "done" means we're mid-transition.
  isTransitioning: boolean;
};

// Drives the post-hand transition timeline. Pass the current `handId`; the
// hook detects changes and walks `phase` through dealer → sb → bb → done.
//
// On the very first hand seen by the screen we go straight to "done": there's
// no previous hand to transition from, so animations would be confusing.
export function useHandTransitionAnimation(
  handId: Id<"hands"> | undefined,
): HandTransitionAnimation {
  const [phase, setPhase] = useState<HandTransitionPhase>("done");
  const prevHandIdRef = useRef<Id<"hands"> | undefined>(undefined);

  useEffect(() => {
    if (!handId) {
      // No hand in flight — reset so the next hand we see is treated as a
      // fresh "first hand" rather than a transition.
      prevHandIdRef.current = undefined;
      setPhase("done");
      return;
    }

    const isFirstHandSeen = prevHandIdRef.current === undefined;
    if (isFirstHandSeen) {
      prevHandIdRef.current = handId;
      // Stay in "done"; nothing to animate.
      return;
    }

    if (prevHandIdRef.current === handId) return; // no change

    prevHandIdRef.current = handId;
    setPhase("dealer");
    const tSb = setTimeout(() => setPhase("sb"), SB_DELAY_MS);
    const tBb = setTimeout(() => setPhase("bb"), BB_DELAY_MS);
    const tDone = setTimeout(() => setPhase("done"), TRANSITION_TOTAL_MS);
    return () => {
      clearTimeout(tSb);
      clearTimeout(tBb);
      clearTimeout(tDone);
    };
  }, [handId]);

  // Synchronous override: on the very first render after `handId` changes,
  // `phase` is still its previous value (the useEffect runs after commit).
  // We detect the mismatch via the ref and report "dealer" up to the caller
  // for that one frame — this is what lets BetChips attached to the new
  // hand id read `isTransitioning=true` on their first render and pick up
  // their delayed entering animation.
  const isTransitionStart =
    !!handId &&
    prevHandIdRef.current !== undefined &&
    prevHandIdRef.current !== handId;
  const effectivePhase: HandTransitionPhase = isTransitionStart
    ? "dealer"
    : phase;

  return {
    phase: effectivePhase,
    isTransitioning: effectivePhase !== "done",
  };
}
