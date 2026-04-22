import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";

/**
 * Returns the currently-authenticated user's row.
 * - `undefined` while loading
 * - `null` when not signed in
 * - `{ _id, displayName, ... }` when signed in
 */
export function useMe() {
  return useQuery(api.users.getCurrentUser);
}
