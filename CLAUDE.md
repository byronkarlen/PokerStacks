<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Project: PokerStacks

Companion app for in-person poker — tracks stacks, pots, and bets so the table doesn't have to. iOS/Android only (no web). Expo Router on the client; Convex on the backend.

### Backend conventions (`convex/`)

- **Auth:** every public mutation starts with `await requireAuth(ctx)` (see `authHelpers.ts`). Host-only mutations additionally check `game.hostUserId === userId`.
- **Action stream is append-only — with one exception:** `undoLastAction` is allowed to delete actions and recompute hand state. If you add anything else that mutates `actions`, expect it to be wrong.
- **Hand state is derived from actions.** `hands.pot/currentBet/minRaise/lastFullRaiseSequence/toActSeatIndex/street` are maintained by `recordAction`'s state machine but can be re-derived from the action stream by `deriveHandState` in `hands.ts`. If you change one, change the other — they are intentionally redundant for performance, not divergent semantics.
- **Hand completion auto-starts the next hand** (`initiateNextOrEnd`). When reasoning about "what does the host see right now," remember the screen may already be showing hand N+1's blinds even though the user just acted on hand N.
- **`markBustedSeats` flips active+0-chip seats to inactive** at hand completion. Anything that reverses a completion (e.g. undo) must consider whether to reverse the flip.

### Client conventions (`src/`)

- Screens live in `src/app/` (expo-router file-based). Hand screen is `src/app/table/[code]/hand.tsx`.
- Hand UI building blocks split across `src/components/hand/` (hand-specific) and `src/components/table/` (shared with lobby).
- Theme tokens are in `src/theme.ts` ("Classy Felt": warm dark + gold accent + ivory display). Avatar palette is separate from UI chrome.
- Mutations called from a screen use the `useMutation(api.x.y)` + `try/catch` + inline error pattern (see `endError`/`undoError` in `hand.tsx`). Convex error messages come wrapped in a noisy envelope — `parseConvexErrorMessage` in `hand.tsx` extracts the actual message.

### Things the app deliberately does NOT do

- Deal or track cards — the physical deck is the deck.
- Enforce hand rankings — humans pick the winner.
- Run on the web — iOS/Android only.
- Allow non-host stack increases — the host is the banker, every chip-up goes through them.

### Common workflows

```bash
npx tsc --noEmit    # typecheck (covers convex/ + src/)
npm run lint        # expo lint
npx convex dev      # backend dev loop (regenerates _generated/ on schema change)
npx expo start      # client
```
