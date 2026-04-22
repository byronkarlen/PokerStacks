import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { requireAuth } from "./authHelpers";

// =============================================================================
// Types
// =============================================================================

type Seat = Doc<"seats">;
type Hand = Doc<"hands">;
type Action = Doc<"actions">;
type Street = "preflop" | "flop" | "turn" | "river";
type ActionType = Action["type"];

// =============================================================================
// Seat ring helpers
// =============================================================================

/**
 * The set of seats currently eligible to play hands at the table.
 * Returned sorted by seatIndex ascending.
 */
async function getActiveSeats(
  ctx: QueryCtx | MutationCtx,
  gameId: Id<"games">,
): Promise<Seat[]> {
  const seats = await ctx.db
    .query("seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  return seats
    .filter((s) => s.status === "active")
    .sort((a, b) => a.seatIndex - b.seatIndex);
}

/**
 * Find the next seat clockwise from the given seatIndex, restricted to seats
 * present in `ring`. Wraps around. Returns null if the ring is empty.
 */
function nextInRing(ring: Seat[], fromIndex: number): Seat | null {
  if (ring.length === 0) return null;
  const after = ring.find((s) => s.seatIndex > fromIndex);
  if (after) return after;
  return ring[0];
}

// =============================================================================
// Hand state derivation from the action stream
// =============================================================================

type HandState = {
  actions: Action[];
  committedTotal: Map<Id<"seats">, number>;
  committedStreet: Map<Id<"seats">, number>;
  actedThisStreet: Set<Id<"seats">>;
  folded: Set<Id<"seats">>;
  allIn: Set<Id<"seats">>;
  lastSequence: number;
};

async function getHandState(
  ctx: QueryCtx | MutationCtx,
  hand: Hand,
): Promise<HandState> {
  const all = await ctx.db
    .query("actions")
    .withIndex("by_hand_and_sequence", (q) => q.eq("handId", hand._id))
    .collect();

  const committedTotal = new Map<Id<"seats">, number>();
  const committedStreet = new Map<Id<"seats">, number>();
  const actedThisStreet = new Set<Id<"seats">>();
  const folded = new Set<Id<"seats">>();
  const allIn = new Set<Id<"seats">>();
  let lastSequence = 0;

  const currentStreet =
    hand.street === "showdown" || hand.street === "complete"
      ? "river"
      : (hand.street as Street);

  for (const a of all) {
    lastSequence = Math.max(lastSequence, a.sequence);
    committedTotal.set(
      a.seatId,
      (committedTotal.get(a.seatId) ?? 0) + a.amount,
    );
    if (a.street === currentStreet) {
      committedStreet.set(
        a.seatId,
        (committedStreet.get(a.seatId) ?? 0) + a.amount,
      );
      if (a.type !== "post_sb" && a.type !== "post_bb") {
        actedThisStreet.add(a.seatId);
      }
    }
    if (a.type === "fold") folded.add(a.seatId);
    if (a.type === "all_in") allIn.add(a.seatId);
  }

  return {
    actions: all,
    committedTotal,
    committedStreet,
    actedThisStreet,
    folded,
    allIn,
    lastSequence,
  };
}

// =============================================================================
// Queries
// =============================================================================

export const getActions = query({
  args: { handId: v.id("hands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("actions")
      .withIndex("by_hand_and_sequence", (q) => q.eq("handId", args.handId))
      .collect();
  },
});

type Pot = {
  index: number;
  amount: number;
  eligibleSeatIds: Id<"seats">[];
};

/**
 * Compute the pot structure for a hand, applying the side-pot algorithm.
 * Returns an array of pots ordered smallest side pot first, main pot last.
 * Each pot lists its amount and the seat IDs eligible to win it
 * (non-folded, with at least the pot's commitment level).
 */
async function computePotStructure(
  ctx: QueryCtx | MutationCtx,
  hand: Hand,
): Promise<{ pot: number; pots: Pot[] }> {
  const all = await ctx.db
    .query("actions")
    .withIndex("by_hand_and_sequence", (q) => q.eq("handId", hand._id))
    .collect();

  // Per-seat totals across the whole hand.
  const total = new Map<Id<"seats">, number>();
  const folded = new Set<Id<"seats">>();
  const allInSet = new Set<Id<"seats">>();
  for (const a of all) {
    total.set(a.seatId, (total.get(a.seatId) ?? 0) + a.amount);
    if (a.type === "fold") folded.add(a.seatId);
    if (a.type === "all_in") allInSet.add(a.seatId);
  }

  // Distinct all-in commitment levels, ascending.
  const allInLevels = Array.from(
    new Set(
      Array.from(allInSet).map((sid) => total.get(sid) ?? 0).filter((v) => v > 0),
    ),
  ).sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  let potIndex = 0;

  // pots[0] is the "main pot" in poker parlance: the slice everyone
  // contributed to (up to the smallest all-in level). Each subsequent pot
  // is a side pot built from chips above the previous level, with a
  // strictly smaller eligibility set.
  //
  // Amount sums EVERY seat's contribution to this band — including folders
  // whose total fell below the level. Eligibility still requires having
  // matched the full level AND not folded.
  for (const level of allInLevels) {
    const amount = Array.from(total.values()).reduce(
      (sum, t) => sum + (Math.min(t, level) - Math.min(t, prev)),
      0,
    );
    const eligible = Array.from(total.entries())
      .filter(([sid, t]) => t >= level && !folded.has(sid))
      .map(([sid]) => sid);
    if (amount > 0) {
      pots.push({ index: potIndex++, amount, eligibleSeatIds: eligible });
    }
    prev = level;
  }

  // Residual side pot: chips bet ABOVE the highest all-in level by
  // non-all-in seats (the deepest side pot).
  const mainContribs = Array.from(total.entries()).filter(
    ([sid, t]) => !allInSet.has(sid) && t > prev,
  );
  const mainAmount = mainContribs.reduce((acc, [, t]) => acc + (t - prev), 0);
  if (mainAmount > 0) {
    const eligible = mainContribs
      .filter(([sid]) => !folded.has(sid))
      .map(([sid]) => sid);
    pots.push({ index: potIndex++, amount: mainAmount, eligibleSeatIds: eligible });
  }

  // Fallback: no all-ins happened, so there's only a main pot.
  if (pots.length === 0 && hand.pot > 0) {
    const eligible = Array.from(total.keys()).filter((sid) => !folded.has(sid));
    pots.push({
      index: 0,
      amount: hand.pot,
      eligibleSeatIds: eligible,
    });
  }

  return { pot: hand.pot, pots };
}

export const getPotStructure = query({
  args: { handId: v.id("hands") },
  handler: async (ctx, args) => {
    const hand = await ctx.db.get(args.handId);
    if (!hand) return null;
    return await computePotStructure(ctx, hand);
  },
});

// Lightweight bundle for the active hand UI: hand + actions + result.
export const getHandView = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.gameId);
    if (!table || !table.currentHandId) return null;
    const hand = await ctx.db.get(table.currentHandId);
    if (!hand) return null;
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_hand_and_sequence", (q) => q.eq("handId", hand._id))
      .collect();
    const result = await ctx.db
      .query("handResults")
      .withIndex("by_hand", (q) => q.eq("handId", hand._id))
      .unique();
    return { hand, actions, result };
  },
});

// =============================================================================
// startHand — creates a new hand, posts blinds, sets first to act.
// Shared by the host's manual start (first hand) and auto-start after
// pickPotWinner finalizes a hand.
// =============================================================================

async function initiateHand(
  ctx: MutationCtx,
  game: Doc<"games">,
): Promise<Id<"hands"> | null> {
  // Seats eligible to be dealt into this hand: active and with chips.
  const allActive = await getActiveSeats(ctx, game._id);
  const ring = allActive.filter((s) => s.chipStack > 0);
  if (ring.length < 2) return null;

  // Dealer button: first active seat for hand #1, otherwise rotate clockwise.
  const dealerSeat =
    game.dealerSeatIndex < 0
      ? ring[0]
      : (nextInRing(ring, game.dealerSeatIndex) ?? ring[0]);

  // Blinds positioning.
  let sbSeat: Seat;
  let bbSeat: Seat;
  if (ring.length === 2) {
    sbSeat = dealerSeat;
    bbSeat = ring.find((s) => s._id !== dealerSeat._id)!;
  } else {
    sbSeat = nextInRing(ring, dealerSeat.seatIndex)!;
    bbSeat = nextInRing(ring, sbSeat.seatIndex)!;
  }

  // First-to-act preflop.
  const firstToAct =
    ring.length === 2
      ? sbSeat
      : (nextInRing(ring, bbSeat.seatIndex) ?? sbSeat);

  // Hand number = previous max + 1.
  const recent = await ctx.db
    .query("hands")
    .withIndex("by_game_and_number", (q) => q.eq("gameId", game._id))
    .order("desc")
    .take(1);
  const handNumber = (recent[0]?.handNumber ?? 0) + 1;

  const handId = await ctx.db.insert("hands", {
    gameId: game._id,
    handNumber,
    dealerSeatIndex: dealerSeat.seatIndex,
    street: "preflop",
    pot: 0,
    currentBet: 0,
    minRaise: game.bigBlind,
    toActSeatIndex: firstToAct.seatIndex,
  });

  // Post blinds. Stacks may be smaller than the blind — clamp.
  const sbAmount = Math.min(game.smallBlind, sbSeat.chipStack);
  const bbAmount = Math.min(game.bigBlind, bbSeat.chipStack);

  let sequence = 1;
  await ctx.db.insert("actions", {
    handId,
    seatId: sbSeat._id,
    street: "preflop",
    type: "post_sb",
    amount: sbAmount,
    sequence: sequence++,
  });
  await ctx.db.patch(sbSeat._id, { chipStack: sbSeat.chipStack - sbAmount });

  await ctx.db.insert("actions", {
    handId,
    seatId: bbSeat._id,
    street: "preflop",
    type: "post_bb",
    amount: bbAmount,
    sequence: sequence++,
  });
  await ctx.db.patch(bbSeat._id, { chipStack: bbSeat.chipStack - bbAmount });

  await ctx.db.patch(handId, {
    pot: sbAmount + bbAmount,
    currentBet: Math.max(sbAmount, bbAmount),
  });

  await ctx.db.patch(game._id, {
    dealerSeatIndex: dealerSeat.seatIndex,
    currentHandId: handId,
  });

  return handId;
}

// Flip any active seat with 0 chips to "inactive" — they're busted and
// should sit out subsequent hands. Called at every hand-completion path
// AFTER winners have been credited, so only truly busted seats get flipped.
async function markBustedSeats(
  ctx: MutationCtx,
  gameId: Id<"games">,
): Promise<void> {
  const seats = await ctx.db
    .query("seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const s of seats) {
    if (s.status === "active" && s.chipStack === 0) {
      await ctx.db.patch(s._id, { status: "inactive" });
    }
  }
}

// Try to deal the next hand. If fewer than 2 seats still have chips, the
// game can't continue — auto-settle by marking it ended. Used at both hand
// completion paths (pickPotWinner's final step and the single-survivor
// branch of recordAction).
async function initiateNextOrEnd(
  ctx: MutationCtx,
  game: Doc<"games">,
): Promise<void> {
  const newHandId = await initiateHand(ctx, game);
  if (newHandId) return;
  await ctx.db.patch(game._id, { status: "ended" });
  const seats = await ctx.db
    .query("seats")
    .withIndex("by_game", (q) => q.eq("gameId", game._id))
    .collect();
  for (const s of seats) {
    if (s.status === "active" || s.status === "inactive") {
      await ctx.db.patch(s._id, { status: "cashed_out" });
    }
  }
}

// Public: host starts a new hand. Usually only needed for the very first
// hand; subsequent hands auto-start after the prior one finalizes.
export const startHand = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game) throw new Error("Game not found");
    if (game.hostUserId !== userId) throw new Error("Host only");
    if (game.status === "ended") throw new Error("Game has ended");
    if (game.status !== "active") throw new Error("Game not started");

    if (game.currentHandId) {
      const prev = await ctx.db.get(game.currentHandId);
      if (prev && prev.street !== "complete") {
        throw new Error("Previous hand still in progress");
      }
    }

    const handId = await initiateHand(ctx, game);
    if (!handId) throw new Error("Need at least 2 active seats with chips");
    return handId;
  },
});

// =============================================================================
// recordAction — the core game loop mutation
// =============================================================================

export const recordAction = mutation({
  args: {
    handId: v.id("hands"),
    type: v.union(
      v.literal("check"),
      v.literal("bet"),
      v.literal("call"),
      v.literal("raise"),
      v.literal("fold"),
      v.literal("all_in"),
    ),
    // For bet/raise, this is the TARGET amount (total commitment this street).
    // For call/fold/check/all_in it is ignored (computed server-side).
    amount: v.optional(v.number()),
    // Optional: fold on behalf of the seat currently to act. Used when a
    // player is physically away (in the bathroom, etc.) — any seated player
    // can tap it. Restricted to "fold" only.
    onBehalfOf: v.optional(v.id("seats")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const hand = await ctx.db.get(args.handId);
    if (!hand) throw new Error("Hand not found");
    if (hand.street === "complete") throw new Error("Hand already complete");
    if (hand.street === "showdown") {
      throw new Error("Hand is at showdown — award the pot");
    }

    const game = await ctx.db.get(hand.gameId);
    if (!game) throw new Error("Game not found");

    // The caller must be seated somewhere at this game.
    const callerSeat = await ctx.db
      .query("seats")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", hand.gameId).eq("userId", userId),
      )
      .unique();
    if (!callerSeat) throw new Error("Not seated at this game");

    // Resolve the seat that will actually take the action. Normally the
    // caller acts for themselves; `onBehalfOf` lets anyone at the table fold
    // the current actor when they're AFK.
    let seat = callerSeat;
    if (args.onBehalfOf) {
      if (args.type !== "fold") {
        throw new Error("Only fold is allowed on behalf of another seat");
      }
      const target = await ctx.db.get(args.onBehalfOf);
      if (!target) throw new Error("Target seat not found");
      if (target.gameId !== hand.gameId) {
        throw new Error("Target seat is not at this game");
      }
      if (target.seatIndex !== hand.toActSeatIndex) {
        throw new Error("Target seat is not currently to act");
      }
      seat = target;
    } else if (hand.toActSeatIndex !== seat.seatIndex) {
      throw new Error("Not your turn");
    }

    const state = await getHandState(ctx, hand);
    const ring = await getActiveSeats(ctx, hand.gameId);
    const street = hand.street as Street;

    const callerStreetCommit = state.committedStreet.get(seat._id) ?? 0;
    const thisActionSeq = state.lastSequence + 1;

    // Reopening rule (TDA): a player can only raise if they have not already
    // taken a voluntary action on this street since the last FULL raise. A
    // short all-in (raise delta < minRaise) does not reopen the action.
    // Uses `>=` so the player who made the last full raise cannot themselves
    // re-raise without another aggressor in between.
    const callerActedSinceReopen = (() => {
      const reopenSeq = hand.lastFullRaiseSequence;
      if (reopenSeq === undefined) return false;
      return state.actions.some(
        (a) =>
          a.seatId === seat._id &&
          a.street === street &&
          a.sequence >= reopenSeq &&
          a.type !== "post_sb" &&
          a.type !== "post_bb",
      );
    })();

    // ----- Compute the action's chip delta + final commitment level -----
    let actionType: ActionType = args.type;
    let chipDelta = 0;
    let newCurrentBet = hand.currentBet;
    let newMinRaise = hand.minRaise;
    let newLastFullRaiseSeq = hand.lastFullRaiseSequence;

    switch (args.type) {
      case "check": {
        if (callerStreetCommit !== hand.currentBet) {
          throw new Error("Cannot check — must call or fold");
        }
        chipDelta = 0;
        break;
      }
      case "fold": {
        chipDelta = 0;
        break;
      }
      case "call": {
        const need = hand.currentBet - callerStreetCommit;
        if (need <= 0) throw new Error("Nothing to call — check instead");
        if (need >= seat.chipStack) {
          chipDelta = seat.chipStack;
          actionType = "all_in";
          const newStreetCommit = callerStreetCommit + chipDelta;
          if (newStreetCommit > newCurrentBet) {
            newMinRaise = Math.max(newMinRaise, newStreetCommit - newCurrentBet);
            newCurrentBet = newStreetCommit;
          }
        } else {
          chipDelta = need;
        }
        break;
      }
      case "bet": {
        if (hand.currentBet !== 0) throw new Error("Cannot bet — raise instead");
        const target = args.amount ?? 0;
        if (target < game.bigBlind) {
          throw new Error(`Bet must be at least ${game.bigBlind}`);
        }
        if (target > seat.chipStack) throw new Error("Not enough chips");
        chipDelta = target - callerStreetCommit;
        if (chipDelta === seat.chipStack) actionType = "all_in";
        newCurrentBet = target;
        newMinRaise = target;
        newLastFullRaiseSeq = thisActionSeq;
        break;
      }
      case "raise": {
        if (hand.currentBet === 0) throw new Error("Cannot raise — bet instead");
        if (callerActedSinceReopen) {
          throw new Error("Action is closed — can only call or fold");
        }
        const target = args.amount ?? 0;
        const minLegalTarget = hand.currentBet + hand.minRaise;
        if (target < minLegalTarget) {
          throw new Error(`Raise must be at least ${minLegalTarget}`);
        }
        chipDelta = target - callerStreetCommit;
        if (chipDelta > seat.chipStack) throw new Error("Not enough chips");
        if (chipDelta === seat.chipStack) actionType = "all_in";
        newMinRaise = target - hand.currentBet;
        newCurrentBet = target;
        newLastFullRaiseSeq = thisActionSeq;
        break;
      }
      case "all_in": {
        chipDelta = seat.chipStack;
        if (chipDelta <= 0) throw new Error("No chips to commit");
        actionType = "all_in";
        const newStreetCommit = callerStreetCommit + chipDelta;
        if (newStreetCommit > newCurrentBet) {
          // This all-in raises the current bet. If the caller already acted
          // since the last full raise, they can only call or fold — an all-in
          // that would raise is not a legal action for them.
          if (callerActedSinceReopen) {
            throw new Error("Action is closed — can only call or fold");
          }
          const raiseDelta = newStreetCommit - newCurrentBet;
          if (raiseDelta >= hand.minRaise) {
            newMinRaise = raiseDelta;
            newLastFullRaiseSeq = thisActionSeq;
          }
          // Short all-in: leave newLastFullRaiseSeq unchanged — action does
          // not reopen for players who've already acted.
          newCurrentBet = newStreetCommit;
        }
        break;
      }
    }

    if (chipDelta < 0) throw new Error("Negative chip delta");

    // Insert the action row.
    await ctx.db.insert("actions", {
      handId: hand._id,
      seatId: seat._id,
      street,
      type: actionType,
      amount: chipDelta,
      sequence: state.lastSequence + 1,
    });

    // Debit the seat.
    if (chipDelta > 0) {
      await ctx.db.patch(seat._id, { chipStack: seat.chipStack - chipDelta });
    }

    // Re-read state after our insert.
    const afterState = await getHandState(ctx, { ...hand, street } as Hand);

    // Survivors = active seats not folded.
    const survivors = ring.filter((s) => !afterState.folded.has(s._id));

    // Single-survivor: pot goes to them, hand completes inline.
    if (survivors.length === 1) {
      const winner = survivors[0];
      const newPot = hand.pot + chipDelta;
      await ctx.db.patch(hand._id, {
        pot: newPot,
        currentBet: newCurrentBet,
        minRaise: newMinRaise,
        lastFullRaiseSequence: newLastFullRaiseSeq,
        toActSeatIndex: undefined,
        street: "complete",
      });
      await ctx.db.insert("handResults", {
        handId: hand._id,
        awards: [{ seatId: winner._id, potIndex: 0, amount: newPot }],
      });
      const winnerDoc = await ctx.db.get(winner._id);
      if (winnerDoc) {
        await ctx.db.patch(winner._id, {
          chipStack: winnerDoc.chipStack + newPot,
        });
      }
      await ctx.db.patch(hand.gameId, { currentHandId: undefined });
      await markBustedSeats(ctx, hand.gameId);
      // Auto-start next hand, or end the game if nobody can ante up.
      const updatedGame = await ctx.db.get(hand.gameId);
      if (updatedGame) await initiateNextOrEnd(ctx, updatedGame);
      return null;
    }

    // Live actors = survivors who can still bet (not all-in).
    const liveActors = survivors.filter((s) => !afterState.allIn.has(s._id));

    // Street closed when every live actor has acted and matches currentBet.
    const streetClosed = liveActors.every((s) => {
      const ok = afterState.actedThisStreet.has(s._id);
      const matched = (afterState.committedStreet.get(s._id) ?? 0) === newCurrentBet;
      return ok && matched;
    });

    let nextStreet: Hand["street"] = street;
    let nextToAct: number | undefined;

    if (streetClosed) {
      if (liveActors.length <= 1) {
        nextStreet = "showdown";
        nextToAct = undefined;
      } else {
        nextStreet =
          street === "preflop"
            ? "flop"
            : street === "flop"
            ? "turn"
            : street === "turn"
            ? "river"
            : "showdown";

        if (nextStreet === "showdown") {
          nextToAct = undefined;
        } else {
          const liveRing = liveActors.sort(
            (a, b) => a.seatIndex - b.seatIndex,
          );
          const next = nextInRing(liveRing, hand.dealerSeatIndex);
          nextToAct = next?.seatIndex;
          newCurrentBet = 0;
          newMinRaise = game.bigBlind;
          newLastFullRaiseSeq = undefined;
        }
      }
    } else {
      const liveRing = liveActors.sort((a, b) => a.seatIndex - b.seatIndex);
      const next = nextInRing(liveRing, seat.seatIndex);
      nextToAct = next?.seatIndex;
    }

    await ctx.db.patch(hand._id, {
      pot: hand.pot + chipDelta,
      currentBet: newCurrentBet,
      minRaise: newMinRaise,
      lastFullRaiseSequence: newLastFullRaiseSeq,
      toActSeatIndex: nextToAct,
      street: nextStreet,
    });

    return null;
  },
});

// =============================================================================
// pickPotWinner — incremental showdown resolution.
//
// Each pot gets picked with its own mutation call so every client stays in
// sync on which pot is next. Selections are persisted on hand.pendingAwards;
// when the final pot is picked, the same mutation finalizes the hand:
// writes handResults, credits winners, completes the hand, and auto-starts
// the next one.
// =============================================================================

export const pickPotWinner = mutation({
  args: {
    handId: v.id("hands"),
    // The index into the pot-structure array (pots[0]=main, 1+=side).
    // Clients pass the pot they believe is current; the server no-ops if
    // another client has already picked it (racing clients).
    potIndex: v.number(),
    seatId: v.id("seats"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const hand = await ctx.db.get(args.handId);
    if (!hand) throw new Error("Hand not found");

    // Idempotent: hand already finalized.
    if (hand.street === "complete") return null;
    if (hand.street !== "showdown") {
      throw new Error("Hand is not at showdown");
    }

    // Caller must be seated (any seated player can tap a winner; first wins).
    const callerSeat = await ctx.db
      .query("seats")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", hand.gameId).eq("userId", userId),
      )
      .unique();
    if (!callerSeat) throw new Error("Not seated at this game");

    const { pots } = await computePotStructure(ctx, hand);
    const existing = hand.pendingAwards ?? [];
    const expectedStep = existing.length;

    // Race: someone else already picked for this pot. Silently accept so the
    // tap doesn't error the UI — the query will push the new step shortly.
    if (args.potIndex !== expectedStep) return null;
    if (expectedStep >= pots.length) return null;

    const currentPot = pots[expectedStep];
    if (!currentPot.eligibleSeatIds.includes(args.seatId)) {
      throw new Error("Seat not eligible for this pot");
    }

    // Append this pick, then auto-advance through any subsequent pots where
    // the same winner is also eligible (matches the ordered side-pot
    // structure — if you qualify for the smaller pot and also the larger
    // one above it, you scoop both).
    const newAwards = [
      ...existing,
      {
        seatId: args.seatId,
        potIndex: currentPot.index,
        amount: currentPot.amount,
      },
    ];
    let s = expectedStep + 1;
    while (s < pots.length && pots[s].eligibleSeatIds.includes(args.seatId)) {
      newAwards.push({
        seatId: args.seatId,
        potIndex: pots[s].index,
        amount: pots[s].amount,
      });
      s++;
    }

    // More pots to resolve — persist progress so every client advances.
    if (newAwards.length < pots.length) {
      await ctx.db.patch(hand._id, { pendingAwards: newAwards });
      return null;
    }

    // Final pot picked — finalize the hand.
    await ctx.db.insert("handResults", {
      handId: hand._id,
      awards: newAwards,
    });

    for (const award of newAwards) {
      const seat = await ctx.db.get(award.seatId);
      if (!seat) continue;
      await ctx.db.patch(seat._id, {
        chipStack: seat.chipStack + award.amount,
      });
    }

    await ctx.db.patch(hand._id, {
      street: "complete",
      toActSeatIndex: undefined,
      pendingAwards: undefined,
    });
    await ctx.db.patch(hand.gameId, { currentHandId: undefined });
    await markBustedSeats(ctx, hand.gameId);

    // Auto-start next hand, or end the game if nobody can ante up.
    const updatedGame = await ctx.db.get(hand.gameId);
    if (updatedGame) await initiateNextOrEnd(ctx, updatedGame);

    return null;
  },
});
