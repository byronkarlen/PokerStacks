import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // Users table — we override the Convex Auth users schema with our own
  users: defineTable({
    isAnonymous: v.boolean(),
    displayName: (v.string()),
  }),

  // A game session. Lifecycle: lobby -> active -> ended.
  games: defineTable({
    code: v.string(), // 4-char uppercase alphanumeric
    hostUserId: v.id("users"),
    status: v.union(
      v.literal("lobby"),
      v.literal("active"),
      v.literal("ended"),
    ),
    defaultBuyIn: v.number(), // chips
    smallBlind: v.number(),
    bigBlind: v.number(),
    dealerSeatIndex: v.number(), // -1 until first hand starts
    currentHandId: v.optional(v.id("hands")),
  }).index("by_code", ["code"]),

  // A position at a game held by one user.
  seats: defineTable({
    gameId: v.id("games"),
    userId: v.id("users"), // join to `users` for display name
    seatIndex: v.number(), // 0..N, stable across the session
    chipStack: v.number(),
    color: v.string(), // palette key — scoped to this seat, unique per game
    status: v.union(
      v.literal("active"),
      // Busted — 0 chips after a hand completed. Skipped by hand dealing
      // and turn order, still rendered on the table as a spectator until
      // the game ends.
      v.literal("inactive"),
      v.literal("cashed_out"),
    ),
  })
    .index("by_game", ["gameId"])
    .index("by_game_and_user", ["gameId", "userId"])
    .index("by_user", ["userId"]),

  // One row per hand played at a game.
  hands: defineTable({
    gameId: v.id("games"),
    handNumber: v.number(),
    dealerSeatIndex: v.number(),
    street: v.union(
      v.literal("preflop"),
      v.literal("flop"),
      v.literal("turn"),
      v.literal("river"),
      v.literal("showdown"),
      v.literal("complete"),
    ),
    pot: v.number(), // total chips committed across all streets
    currentBet: v.number(), // highest bet on current street
    minRaise: v.number(), // next legal raise increment
    // Sequence of the last "full" aggression on the current street (bet, raise,
    // or all-in whose raise delta >= minRaise). Used to enforce the reopening
    // rule: a player who already acted past this sequence can only call or
    // fold. Cleared at the start of each new street.
    lastFullRaiseSequence: v.optional(v.number()),
    toActSeatIndex: v.optional(v.number()),
    // Pot-winner picks made so far during multi-pot showdown selection. Set
    // incrementally (one entry per pot as someone taps a winner) so every
    // client stays in sync on which pot is being decided next. Cleared when
    // the hand finalizes — the full set is written to `handResults`.
    pendingAwards: v.optional(
      v.array(
        v.object({
          seatId: v.id("seats"),
          potIndex: v.number(),
          amount: v.number(),
        }),
      ),
    ),
  })
    .index("by_game", ["gameId"])
    .index("by_game_and_number", ["gameId", "handNumber"]),

  // Every betting event within a hand. Append-only.
  actions: defineTable({
    handId: v.id("hands"),
    seatId: v.id("seats"),
    street: v.union(
      v.literal("preflop"),
      v.literal("flop"),
      v.literal("turn"),
      v.literal("river"),
    ),
    type: v.union(
      v.literal("post_sb"),
      v.literal("post_bb"),
      v.literal("check"),
      v.literal("bet"),
      v.literal("call"),
      v.literal("raise"),
      v.literal("fold"),
      v.literal("all_in"),
    ),
    amount: v.number(), // chips committed by THIS action
    sequence: v.number(), // monotonic per hand, server-assigned
  }).index("by_hand_and_sequence", ["handId", "sequence"]),

  // Result of a completed hand.
  handResults: defineTable({
    handId: v.id("hands"),
    awards: v.array(
      v.object({
        seatId: v.id("seats"),
        potIndex: v.number(), // 0 = main pot, 1+ = side pots
        amount: v.number(),
      }),
    ),
  }).index("by_hand", ["handId"]),
});
