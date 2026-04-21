import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Anonymous user identity. The user's `_id` is stored client-side and
  // sent on every request as the identity token.
  users: defineTable({
    displayName: v.string(),
  }),

  // A game session. Lifecycle: lobby -> active -> ended.
  tables: defineTable({
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

  // A position at a table held by one user.
  seats: defineTable({
    tableId: v.id("tables"),
    userId: v.id("users"), // join to `users` for display name
    seatIndex: v.number(), // 0..N, stable across the session
    chipStack: v.number(),
    color: v.string(), // palette key — scoped to this seat, unique per table
    status: v.union(
      v.literal("pending_buy_in"), // joined, host hasn't bought them in yet
      v.literal("active"),
      v.literal("sitting_out"),
      v.literal("cashed_out"),
      v.literal("kicked"),
    ),
  })
    .index("by_table", ["tableId"])
    .index("by_table_and_user", ["tableId", "userId"])
    .index("by_table_and_seat", ["tableId", "seatIndex"])
    .index("by_user", ["userId"]),

  // Buy-ins, rebuys, and cash-outs. Append-only.
  transactions: defineTable({
    tableId: v.id("tables"),
    seatId: v.id("seats"),
    type: v.union(
      v.literal("buy_in"),
      v.literal("rebuy"),
      v.literal("cash_out"),
    ),
    amount: v.number(), // always positive; direction implied by type
  })
    .index("by_table", ["tableId"])
    .index("by_seat", ["seatId"]),

  // One row per hand played at a table.
  hands: defineTable({
    tableId: v.id("tables"),
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
    toActSeatIndex: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    voided: v.boolean(), // true if host voided mid-hand
  })
    .index("by_table", ["tableId"])
    .index("by_table_and_number", ["tableId", "handNumber"]),

  // Every betting event within a hand. Append-only with soft-delete via `undone`.
  actions: defineTable({
    handId: v.id("hands"),
    tableId: v.id("tables"), // denormalized for query convenience
    seatId: v.id("seats"),
    seatIndex: v.number(), // snapshot for history rendering
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
    undone: v.boolean(),
    undoneAt: v.optional(v.number()),
    undoneByUserId: v.optional(v.id("users")),
  })
    .index("by_hand_and_sequence", ["handId", "sequence"])
    .index("by_table", ["tableId"]),

  // Result of a completed hand. Voided when host undoes pot award.
  handResults: defineTable({
    handId: v.id("hands"),
    tableId: v.id("tables"),
    awards: v.array(
      v.object({
        seatId: v.id("seats"),
        potIndex: v.number(), // 0 = main pot, 1+ = side pots
        amount: v.number(),
      }),
    ),
    voided: v.boolean(),
    voidedAt: v.optional(v.number()),
  }).index("by_hand", ["handId"]),

});
