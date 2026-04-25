import { Doc, Id } from "@/convex/_generated/dataModel";

type Hand = Doc<"hands">;
type Action = Doc<"actions">;
type Seat = Doc<"seats">;

// Which actions the local player can take right now, plus the legal bet-size
// range for raising. Pure derivation from the current hand state — easier to
// reason about (and unit-test) when separated from the UI that consumes it.
export type BettingRules = {
  callAmount: number; // chips to add to call the current bet
  myStreetCommit: number; // chips already in on this street
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean; // open the betting (no current bet on this street)
  canRaise: boolean; // raise an existing bet
  canBetOrRaise: boolean; // canBet || canRaise
  canAggress: boolean; // any aggressive option (bet/raise/short all-in)
  // The legal range for the slider:
  minTarget: number; // smallest legal bet/raise size
  maxTarget: number; // all-in (myStreetCommit + chipStack)
  clampedMin: number; // min(minTarget, maxTarget) — used when stack < minTarget
};

export function computeBettingRules({
  hand,
  actions,
  mySeat,
  bigBlind,
}: {
  hand: Hand;
  actions: Action[];
  mySeat: Seat | null;
  bigBlind: number;
}): BettingRules {
  // Showdown / complete have no current betting street; treat them as river
  // for purposes of summing this player's commitment (rare path, only matters
  // if the dock briefly sticks around past river).
  const street =
    hand.street === "showdown" || hand.street === "complete"
      ? "river"
      : hand.street;

  // How much have I already put in on the current street?
  let myStreetCommit = 0;
  if (mySeat) {
    for (const a of actions) {
      if (a.street !== street) continue;
      if (a.seatId !== mySeat._id) continue;
      myStreetCommit += a.amount;
    }
  }

  // Reopening rule: if a short all-in was put in after I already acted, I
  // can only call or fold — no re-raise.
  const myActionClosed = mySeat
    ? actionClosedByShortAllIn(hand, actions, mySeat._id, street)
    : false;

  // A "live" opponent is another participant who is still eligible to bet
  // (not folded, not already all-in). With nobody to match, extra chips just
  // spawn a one-sided side pot — pointless aggression.
  const liveOpponentExists = mySeat
    ? hasLiveOpponent(actions, mySeat._id)
    : false;

  const callAmount = Math.max(0, hand.currentBet - myStreetCommit);
  const canCheck = !!mySeat && hand.currentBet === myStreetCommit;
  const canCall = !!mySeat && !canCheck && callAmount > 0;

  const canAggress =
    !!mySeat && !myActionClosed && liveOpponentExists && mySeat.chipStack > 0;
  const canBet =
    canAggress && hand.currentBet === 0 && mySeat!.chipStack >= bigBlind;
  // A legal raise needs the stack to reach (currentBet + minRaise). A player
  // short of that can only all-in (handled by canAggress).
  const canRaise =
    canAggress &&
    hand.currentBet > 0 &&
    mySeat!.chipStack > callAmount &&
    myStreetCommit + mySeat!.chipStack >= hand.currentBet + hand.minRaise;
  const canBetOrRaise = canBet || canRaise;

  const minTarget = canBet ? bigBlind : hand.currentBet + hand.minRaise;
  const maxTarget = mySeat ? myStreetCommit + mySeat.chipStack : minTarget;
  const clampedMin = Math.min(minTarget, maxTarget);

  return {
    callAmount,
    myStreetCommit,
    canCheck,
    canCall,
    canBet,
    canRaise,
    canBetOrRaise,
    canAggress,
    minTarget,
    maxTarget,
    clampedMin,
  };
}

// True if this player has acted on the current street at or after the last
// short all-in's sequence — meaning the betting was reopened only for others.
function actionClosedByShortAllIn(
  hand: Hand,
  actions: Action[],
  mySeatId: Id<"seats">,
  street: Hand["street"],
): boolean {
  const reopenSeq = hand.lastFullRaiseSequence;
  if (reopenSeq === undefined) return false;
  return actions.some(
    (a) =>
      a.seatId === mySeatId &&
      a.street === street &&
      a.sequence >= reopenSeq &&
      a.type !== "post_sb" &&
      a.type !== "post_bb",
  );
}

function hasLiveOpponent(
  actions: Action[],
  mySeatId: Id<"seats">,
): boolean {
  const participants = new Set<Id<"seats">>();
  const folded = new Set<Id<"seats">>();
  const allIn = new Set<Id<"seats">>();
  for (const a of actions) {
    participants.add(a.seatId);
    if (a.type === "fold") folded.add(a.seatId);
    if (a.type === "all_in") allIn.add(a.seatId);
  }
  for (const sid of participants) {
    if (sid === mySeatId) continue;
    if (folded.has(sid)) continue;
    if (allIn.has(sid)) continue;
    return true;
  }
  return false;
}

// Common pot-relative bet sizes. `currentBet === 0` means no one has bet on
// this street yet, so "pot" sizes are pure fractions of the pot. Otherwise we
// compute "raise to N where the call portion already counts toward the pot
// when figuring the X% pot raise" — standard live-poker math.
export function potTargetForFraction({
  hand,
  myStreetCommit,
  fraction,
}: {
  hand: Hand;
  myStreetCommit: number;
  fraction: number;
}): number {
  const P = hand.pot;
  const B = hand.currentBet;
  const C = myStreetCommit;
  if (B === 0) return P * fraction;
  return B + fraction * (P + B - C);
}
