import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Anonymous device identity. One row per physical device that ever opened the app.
  devices: defineTable({
    deviceId: v.string(), // client-generated UUID v4
    displayName: v.string(),
    color: v.string(), // hex or palette key
    createdAt: v.number(),
  }).index("by_device", ["deviceId"]),

  // A game session. Lifecycle: lobby -> active -> ended.
  tables: defineTable({
    code: v.string(), // 4-char uppercase alphanumeric
    hostDeviceId: v.string(),
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
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  }).index("by_code", ["code"]),

  // A position at a table held by one device.
  seats: defineTable({
    tableId: v.id("tables"),
    deviceId: v.string(), // join to `devices` for display name + color
    seatIndex: v.number(), // 0..N, stable across the session
    chipStack: v.number(),
    status: v.union(
      v.literal("pending_buy_in"), // joined, host hasn't bought them in yet
      v.literal("active"),
      v.literal("sitting_out"),
      v.literal("cashed_out"),
      v.literal("kicked"),
    ),
    joinedAt: v.number(),
  })
    .index("by_table", ["tableId"])
    .index("by_table_and_device", ["tableId", "deviceId"])
    .index("by_table_and_seat", ["tableId", "seatIndex"])
    .index("by_device", ["deviceId"]),

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
    createdAt: v.number(),
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
    startedAt: v.number(),
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
    createdAt: v.number(),
    undone: v.boolean(),
    undoneAt: v.optional(v.number()),
    undoneByDeviceId: v.optional(v.string()),
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
    createdAt: v.number(),
    voided: v.boolean(),
    voidedAt: v.optional(v.number()),
  }).index("by_hand", ["handId"]),

  // Host manual stack adjustments. Audit log.
  stackEdits: defineTable({
    tableId: v.id("tables"),
    seatId: v.id("seats"),
    byDeviceId: v.string(),
    before: v.number(),
    after: v.number(),
    reason: v.string(),
    createdAt: v.number(),
  }).index("by_table", ["tableId"]),

  // All host privileged actions. Audit log.
  hostEvents: defineTable({
    tableId: v.id("tables"),
    byDeviceId: v.string(),
    type: v.union(
      v.literal("kick"),
      v.literal("transfer_host"),
      v.literal("void_hand"),
      v.literal("undo_action"),
      v.literal("undo_pot_award"),
      v.literal("end_game"),
      v.literal("edit_settings"),
      v.literal("edit_stack"),
      v.literal("buy_in"),
      v.literal("rebuy"),
    ),
    payload: v.any(),
    createdAt: v.number(),
  }).index("by_table", ["tableId"]),
});
