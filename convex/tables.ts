import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { pickRandomColor, pickRandomColorExcluding } from "./palette";

// Letters-only — avoids 0/O, 1/I/L confusion AND keeps all glyphs at cap
// height (Georgia italic's digits use old-style figures which drop below
// the baseline). 23^4 ≈ 280k combinations, plenty for collision-free codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

async function findTableByCode(ctx: QueryCtx | MutationCtx, code: string) {
  return await ctx.db
    .query("tables")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

async function requireSeatForUser(
  ctx: QueryCtx | MutationCtx,
  tableId: Id<"tables">,
  userId: Id<"users">,
) {
  const seat = await ctx.db
    .query("seats")
    .withIndex("by_table_and_user", (q) =>
      q.eq("tableId", tableId).eq("userId", userId),
    )
    .unique();
  if (!seat) throw new Error("Not seated at this table");
  return seat;
}

async function requireHost(
  ctx: MutationCtx,
  tableId: Id<"tables">,
  userId: Id<"users">,
) {
  const table = await ctx.db.get(tableId);
  if (!table) throw new Error("Table not found");
  if (table.hostUserId !== userId) throw new Error("Host only");
  return table;
}

/**
 * Returns the table the user is currently seated at, if any.
 * Used on app open to deep-link the user back into their game.
 *
 * "Currently seated" means: a seat exists for this user with status
 * != cashed_out / kicked, AND the table is not ended.
 */
export const getMyActiveTable = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Users accumulate one seat per table they've ever joined; bounded scan
    // ordered most-recent-first so the active one (if any) appears early.
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);

    for (const seat of seats) {
      if (seat.status === "cashed_out" || seat.status === "kicked") continue;
      const table = await ctx.db.get(seat.tableId);
      if (!table) continue;
      if (table.status === "ended") continue;
      return { table, seat };
    }

    return null;
  },
});

export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    return await findTableByCode(ctx, args.code.toUpperCase());
  },
});

export const getSeats = query({
  args: { tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();
    seats.sort((a, b) => a.seatIndex - b.seatIndex);
    return seats;
  },
});

// Returns each seat enriched with the user's current displayName.
// Color lives on the seat itself.
export const getSeatsWithProfile = query({
  args: { tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();
    seats.sort((a, b) => a.seatIndex - b.seatIndex);

    return await Promise.all(
      seats.map(async (seat) => {
        const user = await ctx.db.get(seat.userId);
        return {
          ...seat,
          displayName: user?.displayName ?? "?",
        };
      }),
    );
  },
});

export const createTable = mutation({
  args: {
    userId: v.id("users"),
    defaultBuyIn: v.optional(v.number()),
    smallBlind: v.optional(v.number()),
    bigBlind: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Generate a non-colliding code (against any non-ended table).
    let code = randomCode();
    for (let attempts = 0; attempts < 10; attempts++) {
      const existing = await findTableByCode(ctx, code);
      if (!existing || existing.status === "ended") break;
      code = randomCode();
    }

    const defaultBuyIn = args.defaultBuyIn ?? 100;
    const smallBlind = args.smallBlind ?? 0.5;
    const bigBlind = args.bigBlind ?? 1;
    const tableId = await ctx.db.insert("tables", {
      code,
      hostUserId: args.userId,
      status: "lobby",
      defaultBuyIn,
      smallBlind,
      bigBlind,
      // -1 signals "no explicit dealer chosen yet"; hands.ts interprets this
      // as hand #1 → ring[0] (the host). UI displays the Button on seat 0
      // in this state. If the host picks a dealer via setInitialDealer, the
      // value becomes a real index and hands.ts rotates from it.
      dealerSeatIndex: -1,
    });

    // MVP: everyone starts with the fixed default stack — no pending buy-in.
    await ctx.db.insert("seats", {
      tableId,
      userId: args.userId,
      seatIndex: 0,
      chipStack: defaultBuyIn,
      color: pickRandomColor(),
      status: "active",
    });

    return { tableId, code };
  },
});

export const joinTable = mutation({
  args: {
    userId: v.id("users"),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const code = args.code.toUpperCase();
    const table = await findTableByCode(ctx, code);
    if (!table) throw new Error("Table not found");
    if (table.status === "ended") throw new Error("Table has ended");

    // Already seated? Idempotent — return existing seat.
    const existing = await ctx.db
      .query("seats")
      .withIndex("by_table_and_user", (q) =>
        q.eq("tableId", table._id).eq("userId", args.userId),
      )
      .unique();
    if (existing) {
      return { tableId: table._id, code: table.code, seatId: existing._id };
    }

    // Next seatIndex = max + 1.
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_table", (q) => q.eq("tableId", table._id))
      .collect();
    const nextIndex =
      seats.length === 0 ? 0 : Math.max(...seats.map((s) => s.seatIndex)) + 1;

    const usedColors = new Set(seats.map((s) => s.color));

    // MVP: new joiners start with the table's default stack, immediately active.
    const seatId = await ctx.db.insert("seats", {
      tableId: table._id,
      userId: args.userId,
      seatIndex: nextIndex,
      chipStack: table.defaultBuyIn,
      color: pickRandomColorExcluding(usedColors),
      status: "active",
    });

    return { tableId: table._id, code: table.code, seatId };
  },
});

// Host-only: bring a seat from pending_buy_in to active with the given chips.
export const buyInSeat = mutation({
  args: {
    userId: v.id("users"),
    seatId: v.id("seats"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0) throw new Error("Amount must be positive");

    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    const table = await requireHost(ctx, seat.tableId, args.userId);

    if (seat.status !== "pending_buy_in") {
      throw new Error("Seat is not awaiting a buy-in");
    }

    await ctx.db.patch(seat._id, {
      chipStack: args.amount,
      status: "active",
    });

    await ctx.db.insert("transactions", {
      tableId: seat.tableId,
      seatId: seat._id,
      type: "buy_in",
      amount: args.amount,
    });

    return { seatId: seat._id, code: table.code };
  },
});

// Host-only: transition the table from lobby to active. Only allowed when at
// least two seats are active (bought in). The actual first hand is dealt by
// startHand once the table is active.
export const startGame = mutation({
  args: { userId: v.id("users"), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await requireHost(ctx, args.tableId, args.userId);
    if (table.status !== "lobby") {
      throw new Error("Game already started");
    }

    const seats = await ctx.db
      .query("seats")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();
    const activeCount = seats.filter((s) => s.status === "active").length;
    if (activeCount < 2) {
      throw new Error("Need at least 2 players bought in");
    }

    await ctx.db.patch(args.tableId, { status: "active" });
    return null;
  },
});

// Host-only: add chips to an active seat. Allowed only between hands per §6.5.
export const rebuySeat = mutation({
  args: {
    userId: v.id("users"),
    seatId: v.id("seats"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0) throw new Error("Amount must be positive");

    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    const table = await requireHost(ctx, seat.tableId, args.userId);

    if (table.currentHandId) {
      throw new Error("Cannot rebuy mid-hand — wait until the next hand");
    }

    if (seat.status !== "active" && seat.status !== "sitting_out") {
      throw new Error("Seat must be active or sitting out to rebuy");
    }

    await ctx.db.patch(seat._id, { chipStack: seat.chipStack + args.amount });

    await ctx.db.insert("transactions", {
      tableId: seat.tableId,
      seatId: seat._id,
      type: "rebuy",
      amount: args.amount,
    });

    return null;
  },
});

// Host-only: remove a player from the table. Their remaining stack is recorded
// as an implicit cash-out for settlement. Mid-hand kicks leave already-
// committed chips in the pot (effectively a fold).
export const kickPlayer = mutation({
  args: { userId: v.id("users"), seatId: v.id("seats") },
  handler: async (ctx, args) => {
    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    const table = await requireHost(ctx, seat.tableId, args.userId);

    if (seat.userId === table.hostUserId) {
      throw new Error("Host cannot kick themselves — transfer host first");
    }

    if (seat.status === "kicked" || seat.status === "cashed_out") {
      throw new Error("Seat already removed");
    }

    const remainingChips = seat.chipStack;

    await ctx.db.patch(seat._id, { status: "kicked", chipStack: 0 });

    if (remainingChips > 0) {
      await ctx.db.insert("transactions", {
        tableId: seat.tableId,
        seatId: seat._id,
        type: "cash_out",
        amount: remainingChips,
      });
    }

    return null;
  },
});

// Host-only: manually adjust a seat's chip stack.
export const editStack = mutation({
  args: {
    userId: v.id("users"),
    seatId: v.id("seats"),
    newAmount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.newAmount < 0) throw new Error("Amount cannot be negative");

    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    await requireHost(ctx, seat.tableId, args.userId);

    await ctx.db.patch(seat._id, { chipStack: args.newAmount });

    return null;
  },
});

// Host-only: transfer the host role to another active seat at the table.
export const transferHost = mutation({
  args: { userId: v.id("users"), toSeatId: v.id("seats") },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.toSeatId);
    if (!target) throw new Error("Seat not found");

    const table = await requireHost(ctx, target.tableId, args.userId);

    if (target.userId === table.hostUserId) {
      throw new Error("Already the host");
    }
    if (target.status !== "active" && target.status !== "sitting_out") {
      throw new Error("Target seat is not playable");
    }

    await ctx.db.patch(table._id, { hostUserId: target.userId });

    return null;
  },
});

// =============================================================================
// Player self-service: sitOut / sitIn / cashOut
// =============================================================================

async function requireBetweenHands(
  ctx: QueryCtx | MutationCtx,
  tableId: Id<"tables">,
) {
  const table = await ctx.db.get(tableId);
  if (table?.currentHandId) {
    throw new Error("Wait until the current hand ends");
  }
}

export const sitOut = mutation({
  args: { userId: v.id("users"), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const seat = await requireSeatForUser(ctx, args.tableId, args.userId);
    if (seat.status !== "active") {
      throw new Error("Only an active seat can sit out");
    }
    await requireBetweenHands(ctx, args.tableId);
    await ctx.db.patch(seat._id, { status: "sitting_out" });
    return null;
  },
});

export const sitIn = mutation({
  args: { userId: v.id("users"), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const seat = await requireSeatForUser(ctx, args.tableId, args.userId);
    if (seat.status !== "sitting_out") {
      throw new Error("Seat is not sitting out");
    }
    await requireBetweenHands(ctx, args.tableId);
    await ctx.db.patch(seat._id, { status: "active" });
    return null;
  },
});

export const cashOut = mutation({
  args: { userId: v.id("users"), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const seat = await requireSeatForUser(ctx, args.tableId, args.userId);
    const table = await ctx.db.get(args.tableId);
    if (!table) throw new Error("Table not found");

    if (seat.status === "cashed_out" || seat.status === "kicked") {
      throw new Error("Already left the table");
    }

    // Host must transfer the role before cashing out so the table isn't orphaned.
    if (table.hostUserId === args.userId) {
      throw new Error("Transfer host before cashing out");
    }

    await requireBetweenHands(ctx, args.tableId);

    const remaining = seat.chipStack;
    await ctx.db.patch(seat._id, { status: "cashed_out", chipStack: 0 });

    if (remaining > 0) {
      await ctx.db.insert("transactions", {
        tableId: args.tableId,
        seatId: seat._id,
        type: "cash_out",
        amount: remaining,
      });
    }

    return null;
  },
});

// =============================================================================
// endGame (host) — terminate the session, settle outstanding seats
// =============================================================================

export const endGame = mutation({
  args: { userId: v.id("users"), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await requireHost(ctx, args.tableId, args.userId);
    // Idempotent — if a duplicate call lands (double-tap, race, re-opened
    // settings after the game already ended), just no-op rather than
    // surfacing a scary error.
    if (table.status === "ended") return null;

    const now = Date.now();

    // 1. Void any active hand (refunds bets to seats).
    if (table.currentHandId) {
      const hand = await ctx.db.get(table.currentHandId);
      if (hand && !hand.voided) {
        const all = await ctx.db
          .query("actions")
          .withIndex("by_hand_and_sequence", (q) => q.eq("handId", hand._id))
          .collect();
        const refund = new Map<Id<"seats">, number>();
        for (const a of all) {
          if (a.undone) continue;
          refund.set(a.seatId, (refund.get(a.seatId) ?? 0) + a.amount);
        }
        for (const [seatId, amount] of refund) {
          const seat = await ctx.db.get(seatId);
          if (!seat) continue;
          await ctx.db.patch(seat._id, { chipStack: seat.chipStack + amount });
        }
        // Also void any pre-existing result.
        const result = await ctx.db
          .query("handResults")
          .withIndex("by_hand", (q) => q.eq("handId", hand._id))
          .unique();
        if (result && !result.voided) {
          for (const award of result.awards) {
            const seat = await ctx.db.get(award.seatId);
            if (!seat) continue;
            await ctx.db.patch(seat._id, {
              chipStack: seat.chipStack - award.amount,
            });
          }
          await ctx.db.patch(result._id, { voided: true, voidedAt: now });
        }
        await ctx.db.patch(hand._id, {
          voided: true,
          street: "complete",
          completedAt: now,
          toActSeatIndex: undefined,
        });
      }
      await ctx.db.patch(table._id, { currentHandId: undefined });
    }

    // 2. Auto-cash-out remaining seats (active and sitting_out) at current stack.
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();
    for (const seat of seats) {
      if (seat.status !== "active" && seat.status !== "sitting_out") continue;
      const remaining = seat.chipStack;
      await ctx.db.patch(seat._id, { status: "cashed_out", chipStack: 0 });
      if (remaining > 0) {
        await ctx.db.insert("transactions", {
          tableId: args.tableId,
          seatId: seat._id,
          type: "cash_out",
          amount: remaining,
        });
      }
    }

    // 3. Mark the table ended.
    await ctx.db.patch(table._id, { status: "ended" });

    return null;
  },
});

// Host-only: pick which seat is the opening dealer. Lobby-only — once the
// game starts, the dealer button rotates automatically per-hand.
export const setInitialDealer = mutation({
  args: {
    userId: v.id("users"),
    tableId: v.id("tables"),
    seatId: v.id("seats"),
  },
  handler: async (ctx, args) => {
    const table = await requireHost(ctx, args.tableId, args.userId);
    if (table.status !== "lobby") {
      throw new Error("Can only set the initial dealer in the lobby");
    }
    const seat = await ctx.db.get(args.seatId);
    if (!seat || seat.tableId !== args.tableId) {
      throw new Error("Seat not at this table");
    }
    await ctx.db.patch(args.tableId, { dealerSeatIndex: seat.seatIndex });
    return null;
  },
});

// Host-only: reassign seat order. Client sends the full list of seatIds in
// the new order; server maps them to seatIndex 0..N-1. Dealer follows its
// seat (dealerSeatIndex is updated to match the dealer seat's new index).
// Lobby-only.
export const reorderSeats = mutation({
  args: {
    userId: v.id("users"),
    tableId: v.id("tables"),
    seatIdsInOrder: v.array(v.id("seats")),
  },
  handler: async (ctx, args) => {
    const table = await requireHost(ctx, args.tableId, args.userId);
    if (table.status !== "lobby") {
      throw new Error("Can only reorder seats in the lobby");
    }

    const seats = await ctx.db
      .query("seats")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();

    if (seats.length !== args.seatIdsInOrder.length) {
      throw new Error("Seat list must include every seat");
    }
    const requested = new Set(args.seatIdsInOrder.map((id) => id.toString()));
    for (const s of seats) {
      if (!requested.has(s._id.toString())) {
        throw new Error("Seat list must include every seat");
      }
    }

    // Track the dealer's seatId so we can update dealerSeatIndex after moving.
    const dealerSeat = seats.find(
      (s) => s.seatIndex === table.dealerSeatIndex,
    );

    // Two passes to avoid transient collisions on seatIndex during the shuffle.
    for (let i = 0; i < seats.length; i++) {
      await ctx.db.patch(seats[i]._id, { seatIndex: -1000 - i });
    }
    for (let i = 0; i < args.seatIdsInOrder.length; i++) {
      await ctx.db.patch(args.seatIdsInOrder[i], { seatIndex: i });
    }

    if (dealerSeat) {
      const newIdx = args.seatIdsInOrder.findIndex(
        (id) => id === dealerSeat._id,
      );
      if (newIdx >= 0) {
        await ctx.db.patch(args.tableId, { dealerSeatIndex: newIdx });
      }
    }
    return null;
  },
});

// Host-only: hard-delete the table and every row that references it. Only
// valid after endGame has been called (status === "ended") so we never wipe
// data a settlement could still need. MVP-scoped — for long-term history you'd
// want a soft-delete / archive flag instead.
export const deleteTable = mutation({
  args: { userId: v.id("users"), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await requireHost(ctx, args.tableId, args.userId);
    if (table.status !== "ended") {
      throw new Error("End the game before deleting");
    }

    // handResults is keyed by handId, so grab the table's hands first.
    const hands = await ctx.db
      .query("hands")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();
    for (const hand of hands) {
      const results = await ctx.db
        .query("handResults")
        .withIndex("by_hand", (q) => q.eq("handId", hand._id))
        .collect();
      for (const r of results) await ctx.db.delete(r._id);
      await ctx.db.delete(hand._id);
    }

    // All other child tables indexed by_table.
    for (const indexName of [
      "seats",
      "actions",
      "transactions",
    ] as const) {
      const rows = await ctx.db
        .query(indexName)
        .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }

    await ctx.db.delete(args.tableId);
    return null;
  },
});

// Self-remove from a table during the lobby. Non-host only; during a game,
// use cashOut instead. Hard-deletes the seat row since no chips have moved.
export const leaveTable = mutation({
  args: { userId: v.id("users"), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.tableId);
    if (!table) throw new Error("Table not found");
    if (table.hostUserId === args.userId) {
      throw new Error("Host can't leave — cancel the table instead");
    }
    if (table.status !== "lobby") {
      throw new Error("Game already started — use cash out instead");
    }

    const seat = await ctx.db
      .query("seats")
      .withIndex("by_table_and_user", (q) =>
        q.eq("tableId", args.tableId).eq("userId", args.userId),
      )
      .unique();
    if (!seat) return null; // Idempotent — already gone.

    await ctx.db.delete(seat._id);
    return null;
  },
});

// =============================================================================
// getSettlement — per-seat net and minimal-transfer payment plan
// =============================================================================

export const getSettlement = query({
  args: { tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.tableId);
    if (!table) return null;

    const seats = await ctx.db
      .query("seats")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .collect();

    // Per-seat aggregates.
    type Row = {
      seatId: Id<"seats">;
      userId: Id<"users">;
      displayName: string;
      color: string;
      buyIns: number; // includes initial + rebuys
      cashOuts: number;
      net: number;
    };

    const rows: Row[] = await Promise.all(
      seats
        .filter((s) => s.status !== "pending_buy_in")
        .map(async (seat) => {
          const tx = transactions.filter((t) => t.seatId === seat._id);
          const buyIns = tx
            .filter((t) => t.type === "buy_in" || t.type === "rebuy")
            .reduce((acc, t) => acc + t.amount, 0);
          const cashOuts = tx
            .filter((t) => t.type === "cash_out")
            .reduce((acc, t) => acc + t.amount, 0);
          const user = await ctx.db.get(seat.userId);
          return {
            seatId: seat._id,
            userId: seat.userId,
            displayName: user?.displayName ?? "?",
            color: seat.color,
            buyIns,
            cashOuts,
            net: cashOuts - buyIns,
          };
        }),
    );

    rows.sort((a, b) => b.net - a.net);

    // Minimal-transfer greedy: pair largest debtor with largest creditor.
    type Transfer = {
      fromSeatId: Id<"seats">;
      toSeatId: Id<"seats">;
      fromName: string;
      toName: string;
      amount: number;
    };

    const debtors = rows
      .filter((r) => r.net < 0)
      .map((r) => ({ ...r, owed: -r.net }))
      .sort((a, b) => b.owed - a.owed);
    const creditors = rows
      .filter((r) => r.net > 0)
      .map((r) => ({ ...r, due: r.net }))
      .sort((a, b) => b.due - a.due);

    const transfers: Transfer[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const d = debtors[i];
      const c = creditors[j];
      const amount = Math.min(d.owed, c.due);
      if (amount > 0) {
        transfers.push({
          fromSeatId: d.seatId,
          toSeatId: c.seatId,
          fromName: d.displayName,
          toName: c.displayName,
          amount,
        });
        d.owed -= amount;
        c.due -= amount;
      }
      if (d.owed === 0) i++;
      if (c.due === 0) j++;
    }

    const sumNet = rows.reduce((acc, r) => acc + r.net, 0);

    return {
      table,
      rows,
      transfers,
      sumNetMismatch: sumNet, // should be 0; non-zero indicates a data issue
    };
  },
});
