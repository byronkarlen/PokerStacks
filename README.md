# PokerStacks

Companion app for in-person poker games. Real cards, virtual chips, no sign-in. Each player runs the app on their phone; the app tracks stacks, pots, and bets so the table doesn't have to.

The app does not deal cards, shuffle, or enforce hand rankings — humans at the table are the referees. Mistakes are recoverable, not prevented (host has undo).

## Stack

- **Client:** Expo (React Native) + Expo Router, iOS & Android only
- **Backend:** [Convex](https://convex.dev) — schema, queries, mutations, real-time sync
- **Auth:** `@convex-dev/auth` (anonymous) — no email/password

## Project layout

```
convex/                 schema + queries/mutations
  schema.ts             games, seats, hands, actions, handResults
  games.ts              create/join/start/end + lobby state
  hands.ts              hand state machine + recordAction + pickPotWinner + undoLastAction
  authHelpers.ts        requireAuth helper
src/
  app/                  expo-router screens
    index.tsx           welcome (start / join)
    onboarding.tsx      display name + color
    join.tsx            code entry
    table/[code]/
      lobby.tsx         pre-game seating
      hand.tsx          active hand
      settle.tsx        end-of-game settlement
  components/
    hand/               action dock, top bar, showdown dock, transitions
    table/              oval felt, seat pills, dealer button, bet chips
  hooks/                shared client hooks
  theme.ts              "Classy Felt" tokens (warm dark + gold accent)
```

## Getting started

```bash
npm install
npx convex dev          # provisions / connects the dev deployment
npx expo start          # in another shell
```

You'll need an iOS simulator or Android emulator (or Expo Go for quick smoke tests — note some native modules require a development build). The app is iOS/Android only by design; web is not a target.

### Useful commands

```bash
npx tsc --noEmit        # typecheck (root + convex)
npm run lint            # expo lint
npm run ios             # build & run iOS dev client
npm run android         # build & run Android dev client
```

## How it plays

1. Host creates a table → 4-character code (`/`).
2. Players join with the code; host is seated at seat 0 automatically.
3. Host taps **Start game** once ≥2 seats exist.
4. App auto-starts the first hand, posts blinds, and rotates the dealer button each subsequent hand.
5. Each player records their own actions (check/call/bet/raise/fold/all-in) on their own phone. The server validates legality (turn order, min raise, reopening rule) and advances the street.
6. Showdown: any seated player can tap the winner for each pot; side pots are computed automatically from all-in commitment levels.
7. Single-survivor (everyone else folds) auto-awards without a prompt.
8. Host taps **End** to settle; the settle screen shows final stacks.

### Host-only powers

- **Undo** (top bar): rewinds the most recent meaningful action — last bet/fold/check, the last winner pick at showdown, or the previous hand's completion if it just auto-advanced. Disabled when there's nothing to undo.
- **End**: ends the game; any in-progress hand is refunded.

## Design

CLAUDE.md and AGENTS.md point at the Convex-specific guidelines for backend code.
