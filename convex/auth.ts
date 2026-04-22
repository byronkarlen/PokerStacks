import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";

// Effective-forever session. Convex Auth needs a number; the largest safe
// integer keeps any legit user signed in for the lifetime of JS's number type.
const NEVER_EXPIRE_MS = Number.MAX_SAFE_INTEGER;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Anonymous({
      profile(params) {
        // The displayName arg from `signIn("anonymous", { displayName })`
        // is read here and written to the users row on creation.
        return {
          displayName: String(params.displayName ?? ""),
          isAnonymous: true,
        };
      },
    }),
  ],
  session: {
    totalDurationMs: NEVER_EXPIRE_MS,
    inactiveDurationMs: NEVER_EXPIRE_MS,
  },
});
