import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";

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
  tableId: Id<"tables">,
): Promise<Seat[]> {
  const seats = await ctx.db
    .query("seats")
    .withIndex("by_table", (q) => q.eq("tableId", tableId))
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
  liveActions: Action[];
  // Total chips committed across the whole hand, per seatId.
  committedTotal: Map<Id<"seats">, number>;
  // Chips committed on the current street, per seatId.
  committedStreet: Map<Id<"seats">, number>;
  // Has this seat made any voluntary (non-blind) action on the current street?
  actedThisStreet: Set<Id<"seats">>;
  folded: Set<Id<"seats">>;
  allIn: Set<Id<"seats">>;
  // Highest sequence number used on this hand.
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
  const live = all.filter((a) => !a.undone);

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
  }

  for (const a of live) {
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
    liveActions: live,
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

export const getCurrentHand = query({
  args: { tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.tableId);
    if (!table || !table.currentHandId) return null;
    return await ctx.db.get(table.currentHandId);
  },
});

export const getActions = query({
  args: { handId: v.id("hands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("actions")
      .withIndex("by_hand_and_sequence", (q) => q.eq("handId", args.handId))
      .collect();
  },
});

export const getHandResult = query({
  args: { handId: v.id("hands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("handResults")
      .withIndex("by_hand", (q) => q.eq("handId", args.handId))
      .unique();
  },
});

/**
 * Compute the pot structure for a hand, applying the side-pot algorithm from
 * plan §11. Returns an array of pots ordered smallest side pot first, main
 * pot last. Each pot lists its amount and the seat IDs eligible to win it
 * (non-folded, with at least the pot's commitment level).
 */
export const getPotStructure = query({
  args: { handId: v.id("hands") },
  handler: async (ctx, args) => {
    const hand = await ctx.db.get(args.handId);
    if (!hand) return null;

    const all = await ctx.db
      .query("actions")
      .withIndex("by_hand_and_sequence", (q) => q.eq("handId", hand._id))
      .collect();
    const live = all.filter((a) => !a.undone);

    // Per-seat totals across the whole hand.
    const total = new Map<Id<"seats">, number>();
    const folded = new Set<Id<"seats">>();
    const allInSet = new Set<Id<"seats">>();
    for (const a of live) {
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

    type Pot = {
      index: number;
      amount: number;
      eligibleSeatIds: Id<"seats">[];
      isMain: boolean;
    };

    const pots: Pot[] = [];
    let prev = 0;
    let potIndex = 0;

    // Side pots (one per distinct all-in level, smallest first).
    for (const level of allInLevels) {
      const contributorsAtLevel = Array.from(total.entries()).filter(
        ([, t]) => t >= level,
      );
      const amount = (level - prev) * contributorsAtLevel.length;
      if (amount > 0) {
        const eligible = contributorsAtLevel
          .filter(([sid]) => !folded.has(sid))
          .map(([sid]) => sid);
        pots.push({ index: potIndex++, amount, eligibleSeatIds: eligible, isMain: false });
      }
      prev = level;
    }

    // Main pot: chips bet ABOVE the highest all-in level by non-all-in seats.
    const mainContribs = Array.from(total.entries()).filter(
      ([sid, t]) => !allInSet.has(sid) && t > prev,
    );
    const mainAmount = mainContribs.reduce((acc, [, t]) => acc + (t - prev), 0);
    if (mainAmount > 0) {
      const eligible = mainContribs
        .filter(([sid]) => !folded.has(sid))
        .map(([sid]) => sid);
      pots.push({ index: potIndex++, amount: mainAmount, eligibleSeatIds: eligible, isMain: true });
    }

    // No all-ins, no main side pots — degenerate "no pots" case shouldn't happen
    // for a real hand. Fallback: a single pot with everyone non-folded eligible.
    if (pots.length === 0 && hand.pot > 0) {
      const eligible = Array.from(total.keys()).filter((sid) => !folded.has(sid));
      pots.push({
        index: 0,
        amount: hand.pot,
        eligibleSeatIds: eligible,
        isMain: true,
      });
    }

    return { pot: hand.pot, pots };
  },
});

// Lightweight bundle for the active hand UI: hand + all live actions + result.
export const getHandView = query({
  args: { tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.tableId);
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
// startHand
// =============================================================================

export const startHand = mutation({
  args: { deviceId: v.string(), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.tableId);
    if (!table) throw new Error("Table not found");
    if (table.hostDeviceId !== args.deviceId) throw new Error("Host only");
    if (table.status === "ended") throw new Error("Game has ended");

    // The previous hand must be complete or voided before a new one starts.
    if (table.currentHandId) {
      const prev = await ctx.db.get(table.currentHandId);
      if (prev && prev.street !== "complete" && !prev.voided) {
        throw new Error("Previous hand still in progress");
      }
    }

    // Seats eligible to be dealt into this hand: active and with chips.
    // (A 0-chip "active" seat is one that busted last hand — they need a
    // host rebuy before being dealt back in.)
    const allActive = await getActiveSeats(ctx, table._id);
    const ring = allActive.filter((s) => s.chipStack > 0);
    if (ring.length < 2) {
      throw new Error("Need at least 2 active seats with chips");
    }

    // Dealer button: first active seat for hand #1, otherwise rotate clockwise.
    const dealerSeat =
      table.dealerSeatIndex < 0
        ? ring[0]
        : (nextInRing(ring, table.dealerSeatIndex) ?? ring[0]);

    // Blinds positioning:
    //   Heads-up: dealer posts SB; the other seat posts BB.
    //   3+:       SB is next active after dealer; BB is next after SB.
    let sbSeat: Seat;
    let bbSeat: Seat;
    if (ring.length === 2) {
      sbSeat = dealerSeat;
      bbSeat = ring.find((s) => s._id !== dealerSeat._id)!;
    } else {
      sbSeat = nextInRing(ring, dealerSeat.seatIndex)!;
      bbSeat = nextInRing(ring, sbSeat.seatIndex)!;
    }

    // First-to-act preflop:
    //   Heads-up: dealer/SB acts first.
    //   3+:       UTG = first active after BB.
    const firstToAct =
      ring.length === 2
        ? sbSeat
        : (nextInRing(ring, bbSeat.seatIndex) ?? sbSeat);

    // Hand number = previous max + 1.
    const recent = await ctx.db
      .query("hands")
      .withIndex("by_table_and_number", (q) => q.eq("tableId", table._id))
      .order("desc")
      .take(1);
    const handNumber = (recent[0]?.handNumber ?? 0) + 1;

    const now = Date.now();
    const handId = await ctx.db.insert("hands", {
      tableId: table._id,
      handNumber,
      dealerSeatIndex: dealerSeat.seatIndex,
      street: "preflop",
      pot: 0,
      currentBet: 0,
      minRaise: table.bigBlind,
      toActSeatIndex: firstToAct.seatIndex,
      startedAt: now,
      voided: false,
    });

    // Post blinds. Stacks may be smaller than the blind (rare, mid-game) — clamp.
    const sbAmount = Math.min(table.smallBlind, sbSeat.chipStack);
    const bbAmount = Math.min(table.bigBlind, bbSeat.chipStack);

    let sequence = 1;
    await ctx.db.insert("actions", {
      handId,
      tableId: table._id,
      seatId: sbSeat._id,
      seatIndex: sbSeat.seatIndex,
      street: "preflop",
      type: "post_sb",
      amount: sbAmount,
      sequence: sequence++,
      createdAt: now,
      undone: false,
    });
    await ctx.db.patch(sbSeat._id, { chipStack: sbSeat.chipStack - sbAmount });

    await ctx.db.insert("actions", {
      handId,
      tableId: table._id,
      seatId: bbSeat._id,
      seatIndex: bbSeat.seatIndex,
      street: "preflop",
      type: "post_bb",
      amount: bbAmount,
      sequence: sequence++,
      createdAt: now,
      undone: false,
    });
    await ctx.db.patch(bbSeat._id, { chipStack: bbSeat.chipStack - bbAmount });

    await ctx.db.patch(handId, {
      pot: sbAmount + bbAmount,
      currentBet: Math.max(sbAmount, bbAmount),
    });

    await ctx.db.patch(table._id, {
      status: "active",
      dealerSeatIndex: dealerSeat.seatIndex,
      currentHandId: handId,
    });

    return handId;
  },
});

// =============================================================================
// recordAction — the core game loop mutation
// =============================================================================

export const recordAction = mutation({
  args: {
    deviceId: v.string(),
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
  },
  handler: async (ctx, args) => {
    const hand = await ctx.db.get(args.handId);
    if (!hand) throw new Error("Hand not found");
    if (hand.voided) throw new Error("Hand was voided");
    if (hand.street === "complete") throw new Error("Hand already complete");
    if (hand.street === "showdown") {
      throw new Error("Hand is at showdown — award the pot");
    }

    const table = await ctx.db.get(hand.tableId);
    if (!table) throw new Error("Table not found");

    // Resolve caller's seat at this table.
    const seat = await ctx.db
      .query("seats")
      .withIndex("by_table_and_device", (q) =>
        q.eq("tableId", hand.tableId).eq("deviceId", args.deviceId),
      )
      .unique();
    if (!seat) throw new Error("Not seated at this table");

    if (hand.toActSeatIndex !== seat.seatIndex) {
      throw new Error("Not your turn");
    }

    const state = await getHandState(ctx, hand);
    const ring = await getActiveSeats(ctx, hand.tableId);
    const street = hand.street as Street;

    const callerStreetCommit = state.committedStreet.get(seat._id) ?? 0;

    // ----- Compute the action's chip delta + final commitment level -----
    let actionType: ActionType = args.type;
    let chipDelta = 0; // chips moving from stack to pot this action
    let newCurrentBet = hand.currentBet;
    let newMinRaise = hand.minRaise;

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
          // Auto-convert to all-in if the call exceeds (or equals) the stack.
          chipDelta = seat.chipStack;
          actionType = "all_in";
          // The all-in commitment may be below currentBet (cold call short),
          // in which case currentBet does not change.
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
        if (!Number.isInteger(target) || target < table.bigBlind) {
          throw new Error(`Bet must be at least ${table.bigBlind}`);
        }
        if (target > seat.chipStack) throw new Error("Not enough chips");
        chipDelta = target - callerStreetCommit;
        if (chipDelta === seat.chipStack) actionType = "all_in";
        newCurrentBet = target;
        newMinRaise = target;
        break;
      }
      case "raise": {
        if (hand.currentBet === 0) throw new Error("Cannot raise — bet instead");
        const target = args.amount ?? 0;
        const minLegalTarget = hand.currentBet + hand.minRaise;
        if (!Number.isInteger(target) || target < minLegalTarget) {
          throw new Error(`Raise must be at least ${minLegalTarget}`);
        }
        chipDelta = target - callerStreetCommit;
        if (chipDelta > seat.chipStack) throw new Error("Not enough chips");
        if (chipDelta === seat.chipStack) actionType = "all_in";
        newMinRaise = target - hand.currentBet;
        newCurrentBet = target;
        break;
      }
      case "all_in": {
        chipDelta = seat.chipStack;
        if (chipDelta <= 0) throw new Error("No chips to commit");
        actionType = "all_in";
        const newStreetCommit = callerStreetCommit + chipDelta;
        if (newStreetCommit > newCurrentBet) {
          // A raise-sized all-in resets minRaise. A short all-in does not.
          const raiseDelta = newStreetCommit - newCurrentBet;
          if (raiseDelta >= hand.minRaise) {
            newMinRaise = raiseDelta;
          }
          newCurrentBet = newStreetCommit;
        }
        break;
      }
    }

    if (chipDelta < 0) throw new Error("Negative chip delta");

    const now = Date.now();

    // Insert the action row.
    await ctx.db.insert("actions", {
      handId: hand._id,
      tableId: hand.tableId,
      seatId: seat._id,
      seatIndex: seat.seatIndex,
      street,
      type: actionType,
      amount: chipDelta,
      sequence: state.lastSequence + 1,
      createdAt: now,
      undone: false,
    });

    // Debit the seat.
    if (chipDelta > 0) {
      await ctx.db.patch(seat._id, { chipStack: seat.chipStack - chipDelta });
    }

    // ----- Determine next state: still on this street, advance, or complete -----
    // Re-read state after our insert.
    const afterState = await getHandState(ctx, {
      ...hand,
      street,
    } as Hand);

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
        toActSeatIndex: undefined,
        street: "complete",
        completedAt: now,
      });
      await ctx.db.insert("handResults", {
        handId: hand._id,
        tableId: hand.tableId,
        awards: [{ seatId: winner._id, potIndex: 0, amount: newPot }],
        createdAt: now,
        voided: false,
      });
      const winnerDoc = await ctx.db.get(winner._id);
      if (winnerDoc) {
        await ctx.db.patch(winner._id, {
          chipStack: winnerDoc.chipStack + newPot,
        });
      }
      await ctx.db.patch(hand.tableId, { currentHandId: undefined });
      return null;
    }

    // Live actors = survivors who can still bet (not all-in).
    const liveActors = survivors.filter((s) => !afterState.allIn.has(s._id));

    // Street closed when every live actor has acted this street and their
    // street commitment matches currentBet.
    const streetClosed = liveActors.every((s) => {
      const ok = afterState.actedThisStreet.has(s._id);
      const matched = (afterState.committedStreet.get(s._id) ?? 0) === newCurrentBet;
      return ok && matched;
    });

    let nextStreet: Hand["street"] = street;
    let nextToAct: number | undefined;

    if (streetClosed) {
      // If <=1 live actors, no more betting — straight to showdown.
      if (liveActors.length <= 1) {
        nextStreet = "showdown";
        nextToAct = undefined;
      } else {
        // Advance street.
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
          // First to act on flop/turn/river: first live actor clockwise from dealer.
          const liveRing = liveActors.sort(
            (a, b) => a.seatIndex - b.seatIndex,
          );
          const next = nextInRing(liveRing, hand.dealerSeatIndex);
          nextToAct = next?.seatIndex;
          // Reset per-street counters by patching currentBet/minRaise.
          newCurrentBet = 0;
          newMinRaise = table.bigBlind;
        }
      }
    } else {
      // Find next seat to act: first live actor clockwise from current actor.
      const liveRing = liveActors.sort((a, b) => a.seatIndex - b.seatIndex);
      const next = nextInRing(liveRing, seat.seatIndex);
      nextToAct = next?.seatIndex;
    }

    await ctx.db.patch(hand._id, {
      pot: hand.pot + chipDelta,
      currentBet: newCurrentBet,
      minRaise: newMinRaise,
      toActSeatIndex: nextToAct,
      street: nextStreet,
    });

    return null;
  },
});

// =============================================================================
// awardPot — distribute the pot at showdown (multi-pot supported by §11)
// =============================================================================

export const awardPot = mutation({
  args: {
    deviceId: v.string(),
    handId: v.id("hands"),
    awards: v.array(
      v.object({
        seatId: v.id("seats"),
        potIndex: v.number(),
        amount: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const hand = await ctx.db.get(args.handId);
    if (!hand) throw new Error("Hand not found");
    if (hand.voided) throw new Error("Hand was voided");

    // Idempotent: if the hand is already complete with a non-voided result,
    // silently succeed. This handles concurrent showdown taps from §6.3 step 7.
    if (hand.street === "complete") {
      const existing = await ctx.db
        .query("handResults")
        .withIndex("by_hand", (q) => q.eq("handId", hand._id))
        .unique();
      if (existing && !existing.voided) return null;
    }

    if (hand.street !== "showdown" && hand.street !== "complete") {
      throw new Error("Hand is not at showdown");
    }

    // Caller must be seated at this table (any seated player can tap a winner;
    // first one wins per the plan).
    const callerSeat = await ctx.db
      .query("seats")
      .withIndex("by_table_and_device", (q) =>
        q.eq("tableId", hand.tableId).eq("deviceId", args.deviceId),
      )
      .unique();
    if (!callerSeat) throw new Error("Not seated at this table");

    // Validate awards sum equals the pot.
    const awardTotal = args.awards.reduce((acc, a) => acc + a.amount, 0);
    if (awardTotal !== hand.pot) {
      throw new Error(
        `Awards (${awardTotal}) must total the pot (${hand.pot})`,
      );
    }

    const now = Date.now();
    await ctx.db.insert("handResults", {
      handId: hand._id,
      tableId: hand.tableId,
      awards: args.awards,
      createdAt: now,
      voided: false,
    });

    // Credit each winner.
    for (const award of args.awards) {
      const seat = await ctx.db.get(award.seatId);
      if (!seat) continue;
      await ctx.db.patch(seat._id, {
        chipStack: seat.chipStack + award.amount,
      });
    }

    await ctx.db.patch(hand._id, {
      street: "complete",
      completedAt: now,
      toActSeatIndex: undefined,
    });
    await ctx.db.patch(hand.tableId, { currentHandId: undefined });

    return null;
  },
});
