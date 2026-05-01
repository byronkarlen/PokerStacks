import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import { pickRandomColor, pickRandomColorExcluding } from "./palette";

// Letters-only — avoids 0/O, 1/I/L confusion AND keeps all glyphs at cap
// height (Georgia italic's digits use old-style figures which drop below
// the baseline). 23^4 ≈ 280k combinations, plenty for collision-free codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

// Matches the pill-ring geometry on the table; beyond 8 the seats don't
// have room to lay out cleanly.
const MAX_SEATS = 8;

function randomCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

async function findTableByCode(ctx: QueryCtx | MutationCtx, code: string) {
  return await ctx.db
    .query("games")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

async function requireHost(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
) {
  const table = await ctx.db.get(gameId);
  if (!table) throw new Error("Game not found");
  if (table.hostUserId !== userId) throw new Error("Host only");
  return table;
}

/**
 * Returns the game the user is currently seated at, if any.
 * Used on app open to deep-link the user back into their game.
 */
export const getMyActiveGame = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);

    for (const seat of seats) {
      if (seat.status === "cashed_out") continue;
      const game = await ctx.db.get(seat.gameId);
      if (!game) continue;
      if (game.status === "ended") continue;
      return { game, seat };
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

// Returns each seat enriched with the user's current displayName.
// Color lives on the seat itself.
export const getSeatsWithProfile = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
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

export const createGame = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);

    // Generate a non-colliding code (against any non-ended game).
    let code = randomCode();
    for (let attempts = 0; attempts < 10; attempts++) {
      const existing = await findTableByCode(ctx, code);
      if (!existing || existing.status === "ended") break;
      code = randomCode();
    }

    const defaultBuyIn = 100;
    const smallBlind = 0.5;
    const bigBlind = 1;
    const gameId = await ctx.db.insert("games", {
      code,
      hostUserId: userId,
      status: "lobby",
      defaultBuyIn,
      smallBlind,
      bigBlind,
      // -1 signals "no explicit dealer chosen yet"; hands.ts interprets this
      // as hand #1 → ring[0] (the host).
      dealerSeatIndex: -1,
    });

    // Host gets the first seat.
    await ctx.db.insert("seats", {
      gameId,
      userId,
      seatIndex: 0,
      chipStack: defaultBuyIn,
      color: pickRandomColor(),
      status: "active",
    });

    return { gameId, code };
  },
});

export const joinGame = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const code = args.code.toUpperCase();
    const game = await findTableByCode(ctx, code);
    if (!game) throw new Error("Game not found");
    if (game.status === "ended") throw new Error("Game has ended");
    if (game.status !== "lobby") {
      throw new Error("Game already started");
    }

    // Already seated? Idempotent — return existing seat.
    const existing = await ctx.db
      .query("seats")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", game._id).eq("userId", userId),
      )
      .unique();
    if (existing) {
      return { gameId: game._id, code: game.code, seatId: existing._id };
    }

    // Next seatIndex = max + 1.
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_game", (q) => q.eq("gameId", game._id))
      .collect();
    if (seats.length >= MAX_SEATS) {
      throw new Error(`Game is full (max ${MAX_SEATS} players)`);
    }
    const nextIndex =
      seats.length === 0 ? 0 : Math.max(...seats.map((s) => s.seatIndex)) + 1;

    const usedColors = new Set(seats.map((s) => s.color));

    const seatId = await ctx.db.insert("seats", {
      gameId: game._id,
      userId,
      seatIndex: nextIndex,
      chipStack: game.defaultBuyIn,
      color: pickRandomColorExcluding(usedColors),
      status: "active",
    });

    return { gameId: game._id, code: game.code, seatId };
  },
});

// Self-remove from a game during the lobby. Non-host only. Hard-deletes the
// seat row since no chips have moved.
export const leaveGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game) throw new Error("Game not found");
    if (game.hostUserId === userId) {
      throw new Error("Host can't leave — cancel the game instead");
    }
    if (game.status !== "lobby") {
      throw new Error("Game already started");
    }

    const seat = await ctx.db
      .query("seats")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (!seat) return null; // Idempotent — already gone.

    await ctx.db.delete(seat._id);
    return null;
  },
});

// Host-only: transition from lobby to active. Requires ≥2 players.
// The first hand is started by the hand screen once it mounts.
export const startGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game) throw new Error("Game not found");
    if (game.status !== "lobby") {
      throw new Error("Game already started");
    }

    const seats = await ctx.db
      .query("seats")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    if (seats.length < 2) {
      throw new Error("Need at least 2 players");
    }

    await ctx.db.patch(args.gameId, { status: "active" });
    return null;
  },
});

// Any signed-in player can end the game; settles outstanding seats and
// goes to settlement.
export const endGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game) throw new Error("Game not found");
    // Idempotent.
    if (game.status === "ended") return null;

    // If a hand is in progress, refund every committed bet back to seats,
    // then delete the hand and its actions — aborted mid-hand, never happened.
    // (There is no handResult to worry about: pickPotWinner clears
    // currentHandId in the same transaction it writes the result, so an
    // in-progress hand always has zero results.)
    if (game.currentHandId) {
      const hand = await ctx.db.get(game.currentHandId);
      if (hand) {
        const all = await ctx.db
          .query("actions")
          .withIndex("by_hand_and_sequence", (q) => q.eq("handId", hand._id))
          .collect();
        const refund = new Map<Id<"seats">, number>();
        for (const a of all) {
          refund.set(a.seatId, (refund.get(a.seatId) ?? 0) + a.amount);
        }
        for (const [seatId, amount] of refund) {
          const seat = await ctx.db.get(seatId);
          if (!seat) continue;
          await ctx.db.patch(seat._id, { chipStack: seat.chipStack + amount });
        }
        for (const a of all) await ctx.db.delete(a._id);
        await ctx.db.delete(hand._id);
      }
      await ctx.db.patch(game._id, { currentHandId: undefined });
    }

    // Settle any non-cashed-out seat (active or busted-inactive) — chipStack
    // stays as their final balance.
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    for (const seat of seats) {
      if (seat.status === "cashed_out") continue;
      await ctx.db.patch(seat._id, { status: "cashed_out" });
    }

    await ctx.db.patch(game._id, { status: "ended" });
    return null;
  },
});

/**
 * Final chip balance per seat. Used on the settlement screen.
 */
export const getSettlement = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return null;

    const seats = await ctx.db
      .query("seats")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();

    const rows = await Promise.all(
      seats.map(async (seat) => {
        const user = await ctx.db.get(seat.userId);
        return {
          seatId: seat._id,
          userId: seat.userId,
          displayName: user?.displayName ?? "?",
          color: seat.color,
          chipStack: seat.chipStack,
        };
      }),
    );

    rows.sort((a, b) => b.chipStack - a.chipStack);

    return { game, rows };
  },
});
