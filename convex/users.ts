import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

// Returns the currently-authenticated user's row, or null if not signed in.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db.get(userId);
  },
});

// Update the current user's display name. Used for the edit-name flow.
// (First-time naming happens during signIn("anonymous", { displayName }).)
export const setDisplayName = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    // Token is valid but the user row has been deleted (e.g. DB wipe).
    // Surface a signal the client can catch and recover from via re-signIn.
    if (!user) throw new Error("User row missing — please sign in again");
    await ctx.db.patch(userId, { displayName: args.displayName.trim() });
  },
});
