import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";

// Unambiguous alphabet — avoids 0/O, 1/I/L confusion at the table.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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

async function requireSeatForDevice(
  ctx: QueryCtx | MutationCtx,
  tableId: Id<"tables">,
  deviceId: string,
) {
  const seat = await ctx.db
    .query("seats")
    .withIndex("by_table_and_device", (q) =>
      q.eq("tableId", tableId).eq("deviceId", deviceId),
    )
    .unique();
  if (!seat) throw new Error("Not seated at this table");
  return seat;
}

async function requireHost(
  ctx: MutationCtx,
  tableId: Id<"tables">,
  deviceId: string,
) {
  const table = await ctx.db.get(tableId);
  if (!table) throw new Error("Table not found");
  if (table.hostDeviceId !== deviceId) throw new Error("Host only");
  return table;
}

/**
 * Returns the table the device is currently seated at, if any.
 * Used on app open to deep-link the user back into their game.
 *
 * "Currently seated" means: a seat exists for this device with status
 * != cashed_out / kicked, AND the table is not ended.
 */
export const getMyActiveTable = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    // Devices accumulate one seat per table they've ever joined; bounded scan
    // ordered most-recent-first so the active one (if any) appears early.
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
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

// Returns each seat enriched with the device's current displayName + color.
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
        const device = await ctx.db
          .query("devices")
          .withIndex("by_device", (q) => q.eq("deviceId", seat.deviceId))
          .unique();
        return {
          ...seat,
          displayName: device?.displayName ?? "?",
          color: device?.color ?? "blue",
        };
      }),
    );
  },
});

export const createTable = mutation({
  args: {
    deviceId: v.string(),
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

    const now = Date.now();
    const tableId = await ctx.db.insert("tables", {
      code,
      hostDeviceId: args.deviceId,
      status: "lobby",
      defaultBuyIn: args.defaultBuyIn ?? 200,
      smallBlind: args.smallBlind ?? 1,
      bigBlind: args.bigBlind ?? 2,
      dealerSeatIndex: -1,
      createdAt: now,
    });

    // Host always occupies seat 0, awaiting their own buy-in.
    await ctx.db.insert("seats", {
      tableId,
      deviceId: args.deviceId,
      seatIndex: 0,
      chipStack: 0,
      status: "pending_buy_in",
      joinedAt: now,
    });

    return { tableId, code };
  },
});

export const joinTable = mutation({
  args: {
    deviceId: v.string(),
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
      .withIndex("by_table_and_device", (q) =>
        q.eq("tableId", table._id).eq("deviceId", args.deviceId),
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

    const seatId = await ctx.db.insert("seats", {
      tableId: table._id,
      deviceId: args.deviceId,
      seatIndex: nextIndex,
      chipStack: 0,
      status: "pending_buy_in",
      joinedAt: Date.now(),
    });

    return { tableId: table._id, code: table.code, seatId };
  },
});

// Host-only: bring a seat from pending_buy_in to active with the given chips.
export const buyInSeat = mutation({
  args: {
    deviceId: v.string(),
    seatId: v.id("seats"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0) throw new Error("Amount must be positive");

    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    const table = await requireHost(ctx, seat.tableId, args.deviceId);

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
      createdAt: Date.now(),
    });

    await ctx.db.insert("hostEvents", {
      tableId: seat.tableId,
      byDeviceId: args.deviceId,
      type: "buy_in",
      payload: { seatId: seat._id, amount: args.amount },
      createdAt: Date.now(),
    });

    return { seatId: seat._id, code: table.code };
  },
});

// Host-only: transition the table from lobby to active. Only allowed when at
// least two seats are active (bought in). The actual first hand is dealt by
// startHand once the table is active.
export const startGame = mutation({
  args: { deviceId: v.string(), tableId: v.id("tables") },
  handler: async (ctx, args) => {
    const table = await requireHost(ctx, args.tableId, args.deviceId);
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
    deviceId: v.string(),
    seatId: v.id("seats"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0) throw new Error("Amount must be positive");

    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    const table = await requireHost(ctx, seat.tableId, args.deviceId);

    if (table.currentHandId) {
      throw new Error("Cannot rebuy mid-hand — wait until the next hand");
    }

    if (seat.status !== "active" && seat.status !== "sitting_out") {
      throw new Error("Seat must be active or sitting out to rebuy");
    }

    await ctx.db.patch(seat._id, { chipStack: seat.chipStack + args.amount });

    const now = Date.now();
    await ctx.db.insert("transactions", {
      tableId: seat.tableId,
      seatId: seat._id,
      type: "rebuy",
      amount: args.amount,
      createdAt: now,
    });
    await ctx.db.insert("hostEvents", {
      tableId: seat.tableId,
      byDeviceId: args.deviceId,
      type: "rebuy",
      payload: { seatId: seat._id, amount: args.amount },
      createdAt: now,
    });

    return null;
  },
});

// Host-only: remove a player from the table. Their remaining stack is recorded
// as an implicit cash-out for settlement. Mid-hand kicks leave already-
// committed chips in the pot (effectively a fold).
export const kickPlayer = mutation({
  args: { deviceId: v.string(), seatId: v.id("seats") },
  handler: async (ctx, args) => {
    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    const table = await requireHost(ctx, seat.tableId, args.deviceId);

    if (seat.deviceId === table.hostDeviceId) {
      throw new Error("Host cannot kick themselves — transfer host first");
    }

    if (seat.status === "kicked" || seat.status === "cashed_out") {
      throw new Error("Seat already removed");
    }

    const now = Date.now();
    const remainingChips = seat.chipStack;

    await ctx.db.patch(seat._id, { status: "kicked", chipStack: 0 });

    if (remainingChips > 0) {
      await ctx.db.insert("transactions", {
        tableId: seat.tableId,
        seatId: seat._id,
        type: "cash_out",
        amount: remainingChips,
        createdAt: now,
      });
    }

    await ctx.db.insert("hostEvents", {
      tableId: seat.tableId,
      byDeviceId: args.deviceId,
      type: "kick",
      payload: { seatId: seat._id, remainingChips },
      createdAt: now,
    });

    return null;
  },
});

// Host-only: manually adjust a seat's chip stack with a logged reason.
export const editStack = mutation({
  args: {
    deviceId: v.string(),
    seatId: v.id("seats"),
    newAmount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.newAmount < 0) throw new Error("Amount cannot be negative");
    if (args.reason.trim().length === 0) throw new Error("Reason required");

    const seat = await ctx.db.get(args.seatId);
    if (!seat) throw new Error("Seat not found");

    await requireHost(ctx, seat.tableId, args.deviceId);

    const before = seat.chipStack;
    await ctx.db.patch(seat._id, { chipStack: args.newAmount });

    const now = Date.now();
    await ctx.db.insert("stackEdits", {
      tableId: seat.tableId,
      seatId: seat._id,
      byDeviceId: args.deviceId,
      before,
      after: args.newAmount,
      reason: args.reason.trim(),
      createdAt: now,
    });
    await ctx.db.insert("hostEvents", {
      tableId: seat.tableId,
      byDeviceId: args.deviceId,
      type: "edit_stack",
      payload: {
        seatId: seat._id,
        before,
        after: args.newAmount,
        reason: args.reason.trim(),
      },
      createdAt: now,
    });

    return null;
  },
});

// Host-only: transfer the host role to another active seat at the table.
export const transferHost = mutation({
  args: { deviceId: v.string(), toSeatId: v.id("seats") },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.toSeatId);
    if (!target) throw new Error("Seat not found");

    const table = await requireHost(ctx, target.tableId, args.deviceId);

    if (target.deviceId === table.hostDeviceId) {
      throw new Error("Already the host");
    }
    if (target.status !== "active" && target.status !== "sitting_out") {
      throw new Error("Target seat is not playable");
    }

    await ctx.db.patch(table._id, { hostDeviceId: target.deviceId });
    await ctx.db.insert("hostEvents", {
      tableId: table._id,
      byDeviceId: args.deviceId,
      type: "transfer_host",
      payload: { toSeatId: target._id, toDeviceId: target.deviceId },
      createdAt: Date.now(),
    });

    return null;
  },
});
