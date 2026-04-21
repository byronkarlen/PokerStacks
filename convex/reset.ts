import { internalMutation } from "./_generated/server";

// Dev-only reset — wipes every document in every table. Schema and
// indexes are preserved. Run via:
//   npx convex run reset:clearAllData
//
// Defined as internalMutation so it can never be called from the client.
export const clearAllData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tableNames = [
      "users",
      "tables",
      "seats",
      "transactions",
      "hands",
      "actions",
      "handResults",
    ] as const;

    for (const table of tableNames) {
      while (true) {
        const batch = await ctx.db.query(table).take(100);
        if (batch.length === 0) break;
        for (const doc of batch) await ctx.db.delete(doc._id);
        if (batch.length < 100) break;
      }
    }
  },
});
