import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create or update the local device's profile row.
export const upsertDevice = mutation({
  args: {
    deviceId: v.string(),
    displayName: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        color: args.color,
      });
      return existing._id;
    }

    return await ctx.db.insert("devices", {
      deviceId: args.deviceId,
      displayName: args.displayName,
      color: args.color,
      createdAt: Date.now(),
    });
  },
});

export const getDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devices")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .unique();
  },
});
