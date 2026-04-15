import { v } from "convex/values";
import { query } from "./_generated/server";

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
