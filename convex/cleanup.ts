import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Per-invocation cap on games to fully wipe. Each game can carry many hands
// and many actions; keep the blast radius small and re-invoke via the
// scheduler if more remain.
const BATCH_LIMIT = 5;

/**
 * Delete every game older than 24 hours (any status) along with its hands,
 * handResults, actions, and seats. Re-schedules itself if more old games
 * remain past the batch cap.
 */
export const deleteOldGames = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ONE_DAY_MS;

    const oldGames = await ctx.db
      .query("games")
      .filter((q) => q.lt(q.field("_creationTime"), cutoff))
      .take(BATCH_LIMIT);

    for (const game of oldGames) {
      const hands = await ctx.db
        .query("hands")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      for (const hand of hands) {
        const results = await ctx.db
          .query("handResults")
          .withIndex("by_hand", (q) => q.eq("handId", hand._id))
          .collect();
        for (const r of results) await ctx.db.delete(r._id);

        const actions = await ctx.db
          .query("actions")
          .withIndex("by_hand_and_sequence", (q) => q.eq("handId", hand._id))
          .collect();
        for (const a of actions) await ctx.db.delete(a._id);

        await ctx.db.delete(hand._id);
      }

      const seats = await ctx.db
        .query("seats")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      for (const s of seats) await ctx.db.delete(s._id);

      await ctx.db.delete(game._id);
    }

    // If we saturated the batch, another run's likely needed.
    if (oldGames.length === BATCH_LIMIT) {
      await ctx.scheduler.runAfter(0, internal.cleanup.deleteOldGames, {});
    }
  },
});
