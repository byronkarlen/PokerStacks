import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create a new user row or update an existing one's displayName.
// Returns the user's _id. The client stores that _id locally as its identity
// token and sends it on every subsequent mutation/query.
export const upsertUser = mutation({
  args: {
    userId: v.optional(v.id("users")),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.userId) {
      const existing = await ctx.db.get(args.userId);
      if (existing) {
        if (existing.displayName !== args.displayName) {
          await ctx.db.patch(args.userId, { displayName: args.displayName });
        }
        return args.userId;
      }
      // Stale userId (row was deleted) — fall through to insert a new row.
    }
    return await ctx.db.insert("users", {
      displayName: args.displayName,
    });
  },
});

export const getUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});
