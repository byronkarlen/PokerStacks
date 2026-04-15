# PokerStacks — Design Spec

> Companion app for in-person poker games. Real cards, virtual chips, no sign-in.
> Stack: Expo (React Native) + Convex.

## 1. Vision & Principles

**What it is:** A chip-tracking and bet-recording app for a table of friends playing live poker with a physical deck. The app replaces plastic chips and the "wait, how much is in the pot?" mental math. It does not deal cards, shuffle, or enforce poker rules beyond bet legality — the humans at the table are the referees.

**Design principles:**
- **Zero friction to start.** Host creates a table in under 10 seconds; players join in under 10 seconds. No account, no email, no password.
- **Trust the table.** The app records what the humans agree happened. Mistakes are recoverable, not prevented.
- **Glanceable.** Each player on their own phone. Everything you need for the current moment fits on a single screen — no drilling through menus mid-hand.
- **Authoritative server.** All state lives in Convex. The client is a view; the server is the source of truth.
- **Survives mess.** Phones die, people join late, someone's signal drops, a player changes their mind — nothing breaks.

---

## 2. Identity Model

**No sign-in. Device-anchored anonymous identity.**

- On first launch, generate a `deviceId` (UUID v4), store in `expo-secure-store`. Persists across app kills; lost on uninstall.
- First time the user joins or creates a table, they pick a **display name** and **color**. Stored locally and synced to a `devices` row in Convex.
- On every query/mutation, the client passes its `deviceId`. The server looks up the `seat` keyed to `(tableId, deviceId)` to know who's acting.
- Reconnect: on app open, query "am I currently seated at any active table?" → if yes, deep-link into it.

**Accepted trade-offs:**
- Lose/reset phone mid-game → you're out for the session. Host kicks the seat, which records the current stack as an implicit cash-out (correct: you settle based on what you had when you stopped). No "move my chips to a new phone" flow in MVP — it's a rare enough edge case that we defer it.
- Cannot be at the same table from two devices simultaneously. One person, one seat.
- No cross-session stats tied to a real human. Fine for MVP.

**Future escape hatch (V2, not MVP):** optional passkey/email upgrade to transfer identity to a new phone.

---

## 3. Roles

**The host is the banker.** In a real friends-poker setting, one person holds the cash and issues physical chips after someone Venmos them. PokerStacks mirrors that: the host is the only one who can make a seat's stack go up, in any circumstance. Regular players have no UI for buying in or adding chips — they pay the host off-app, and the host taps a button. This is strict on purpose; it keeps the virtual chip count and the real money flow in lockstep.

Two roles, determined per-table:

| Action | Host | Regular Player |
|---|---|---|
| Create table | yes (becomes host) | — |
| Join table, claim a seat | yes | yes |
| Record own betting actions | yes | yes |
| Cash out self | yes | yes |
| Sit out / sit in | yes | yes |
| **Buy in or rebuy any seat (increase stack)** | **yes** | **no** |
| **Undo any action** | **yes** | **no** |
| **Edit any seat's chip stack** | **yes** | **no** |
| **Kick a player** | **yes** | **no** |
| **Force end game** | **yes** | **no** |
| **Edit table settings (blinds, etc.)** | **yes** | **no** |
| **Transfer host role** | **yes** (to another seat) | **no** |

Host is the device that created the table. Host role is transferable: the current host taps another seat → **Make host**, which swaps `tables.hostDeviceId`. Host role also transfers automatically if the host cashes out (oldest still-`active` seat is promoted).

**Host disappearance is not automatically detected in MVP.** If the host's phone dies or they rage-quit without transferring, the table is stuck — no one else can buy players in, undo, kick, or end the game. Workarounds: the host plugs in / reopens the app (same `deviceId` restores host powers), or the group abandons the session and settles up verbally. Heartbeat-based detection and player-initiated "take over as host" flows are deferred to V1.5.

---

## 4. Vocabulary

| Term | Meaning |
|---|---|
| **Table** | A game session. Has a join code, a host, settings, seats, and a lifecycle (`lobby` → `active` → `ended`). |
| **Seat** | A position at a table held by one device. Has a chip stack and a status (`pending_buy_in`, `active`, `sitting_out`, `cashed_out`, `kicked`). |
| **Hand** | One deal — preflop, flop, turn, river, showdown. |
| **Action** | A recorded bet event: check, bet, call, raise, fold, all-in, post_sb, post_bb. |
| **Pot** | Chips committed in the current hand. Splits into main + side pots when anyone goes all-in. |
| **Buy-in / Rebuy** | A chip purchase. Buy-in is the first; rebuys add to stack mid-game. |
| **Cash-out** | Leaving the table. Remaining stack is recorded as the cash-out amount. |
| **Settlement** | End-of-game per-player net: `sum(cash_outs) − sum(buy_ins) − sum(rebuys)`, where any still-seated player's current stack is first converted into a cash-out. Should sum to zero across the table. |

---

## 5. Feature Scope

### MVP

- Create table → 4-character alphanumeric code
- Join table by code
- Default table config: 200-chip buy-in, 1 SB / 2 BB, no blind timer
- Seats laid out in join order
- Host-initiated buy-ins and rebuys (host is the banker; every stack increase goes through host)
- Record hand actions: check, bet, call, raise, fold, all-in (plus auto-posted blinds)
- Pot tracking with automatic side-pot computation
- Award pot(s) at showdown (handles ties/splits)
- Dealer button auto-rotates each hand
- Host-only undo of last action
- Host-only stack edit with reason
- Host-only kick player
- Cash out (self)
- End game → settlement screen with minimal-transfer payment set
- Full hand/action history (view-only)
- Keep screen awake on active hand view

### V1.5 (post-MVP polish)

- Configurable table settings (buy-in, blinds) at creation and mid-game (host)
- Blind timer + levels (tournament-style)
- Turn notifications (push) when it's your action
- Quick-bet presets (min, ½ pot, pot, all-in)
- Hand replay (step through actions)
- QR code for joining (generation + scanner)
- Deep-link share sheet
- "Table view" mode (a tablet at table center showing all stacks)

### V2

- Tournament mode (eliminations, prize structure, ICM)
- Photo avatars
- Reactions / quick chat
- Identity upgrade (passkey/email) → cross-session stats
- Venmo / Cash App / PayPal deep links from settlement

---

## 6. User Flows

### 6.1 Host creates a table

1. Open app → **Start a game**
2. First-time onboarding: enter display name, pick a color (remembered for future tables)
3. Confirm default settings (200 / 1 / 2) → **Create**
4. Host is seated automatically at seat 0. Host must then tap their own seat and buy in (same flow as any other seat).
5. Lobby screen: large 4-char code, list of seats as they join, **Start game** button (disabled until at least 2 seats have `status = "active"`)

### 6.2 Player joins a table

1. Open app → **Join a game**
2. First-time onboarding (name + color) if needed
3. Enter 4-char code → **Join**
4. Assigned next open seat. Seat starts with `status = "pending_buy_in"` and 0 chips; appears in lobby marked "Awaiting buy-in."
5. Host taps the seat → **Buy in** → confirm amount (default 200). Stack set, `buy_in` transaction logged, status flips to `active`.
6. When host taps **Start game**, everyone auto-navigates to active hand view. Seats still in `pending_buy_in` are skipped in the rotation until bought in.

### 6.3 One hand

1. First hand: dealer button is placed on the lowest `seatIndex` that is `active` (skipping `pending_buy_in`, `sitting_out`, `cashed_out`, `kicked`). Subsequent hands: button rotates clockwise through `active` seats only.
2. App auto-posts SB (first `active` seat left of button) and BB (next `active` seat left of SB). Their stacks debit; pot credits.
3. Action starts on the `active` seat left of BB (preflop UTG). **Heads-up exception:** with exactly 2 active seats, the dealer posts SB and acts first preflop; the other player (BB) acts first on every subsequent street.
4. Active seat's phone shows large action buttons: **Check/Call**, **Bet/Raise** (with slider), **Fold**. Other phones show "Waiting on [Name]."
5. Player taps action. Mutation validates (can they afford it? is it their turn?), records, advances.
6. When a street closes (all active bets matched, or only one player left), advance to next street. App announces street change.
7. At showdown OR when only one player remains:
   - **Single survivor:** `recordAction` auto-awards the pot inline; no prompt. Hand jumps to `complete`.
   - **Showdown (multiple players):** a "Who won?" prompt appears on **every phone** (not just the last actor's). Any player can tap to select the winner(s) and submit. `awardPot` is idempotent on `handId`: if two people tap simultaneously, the first mutation writes `handResults`; the second sees the hand is already `complete` and no-ops with a silent success. If host disagrees with the recorded winner, they can undo.
8. Pot distributes per §11. Stacks update. **Next hand** button appears.

### 6.4 Host undo / edit

- **Undo last action:** host sees **Undo** button in active hand view. Tap → reverses last action (restores chip commitment, rewinds `toActSeatIndex`, possibly rewinds street). Toast to all players: "Host undid [name]'s raise to 20."
- **Edit stack:** host taps a seat → **Edit chips** → new value + required reason. Logged in `stackEdits` table, visible in history.
- **Kick player:** host taps a seat → **Remove player** → confirmation. Seat status → `kicked`. Remaining `chipStack` recorded as an implicit `cash_out` transaction for settlement purposes. If kicked mid-hand: chips already committed to the pot stay in the pot (the player is effectively folded), and only the *remaining* stack is the cash-out amount. The kicked seat is skipped in subsequent hand rotation.

### 6.5 Mid-game player events

- **Rebuy:** host-initiated only, and only between hands. Player asks verbally at the table; host taps that seat → **Add chips** → amount (default: buy-in). Stack increases; `rebuy` transaction logged. `rebuySeat` mutation rejects while `tables.currentHandId != null` (no mid-hand chip injection — standard poker rule). For emergency corrections during a hand, host uses stack-edit (§12) instead, which is logged with a reason.
- **Sit out:** toggle. Won't be dealt; won't post blinds. Can toggle back in between hands.
- **Cash out:** player taps **Cash out** → confirmation. Seat status → `cashed_out`, current stack recorded as cash-out amount. Removed from next hand's rotation. (Cash-out is a stack *decrease* and therefore player-initiated.)

### 6.6 End game

1. Host taps **End game** → confirmation ("This ends the session for everyone.").
2. Any active hand is auto-voided (stacks restored to pre-hand state) — no partial-hand math in settlement.
3. All still-seated players are auto-cashed-out at their current stack.
4. Settlement screen: per-player net, plus minimal-transfer payment list.
5. "Share settlement" → share sheet with plain-text summary.

---

## 7. Screen Architecture

Expo Router, file-based:

```
app/
  _layout.tsx                    ConvexProvider + Stack
  index.tsx                      Welcome (Start | Join)
  onboarding.tsx                 Name + color picker (one-time)
  join.tsx                       Code entry
  table/
    _layout.tsx                  Auto-routes based on table.status
    [code]/
      lobby.tsx                  Pre-game seating
      hand.tsx                   Active hand (My view + Table view toggle)
      history.tsx                Past hands, read-only
      settings.tsx               Host-only: edit settings, kick, transfer host
      settle.tsx                 End-of-game settlement
```

Routing rules:
- Opening the app while seated at an active table → auto-deep-link to `table/[code]/hand` (or `lobby` if status is `lobby`).
- `table/[code]` without a suffix redirects based on `table.status`.

---

## 8. Convex Data Model

```ts
// convex/schema.ts

devices: defineTable({
  deviceId: v.string(),        // client-generated UUID
  displayName: v.string(),
  color: v.string(),           // hex or named palette key
  createdAt: v.number(),
}).index("by_device", ["deviceId"])

tables: defineTable({
  code: v.string(),            // 4-char uppercase alphanumeric
  hostDeviceId: v.string(),
  status: v.union(
    v.literal("lobby"),
    v.literal("active"),
    v.literal("ended"),
  ),
  defaultBuyIn: v.number(),    // chips (MVP: 200)
  smallBlind: v.number(),      // chips (MVP: 1)
  bigBlind: v.number(),        // chips (MVP: 2)
  dealerSeatIndex: v.number(), // -1 until first hand starts
  currentHandId: v.optional(v.id("hands")),
  createdAt: v.number(),
  endedAt: v.optional(v.number()),
}).index("by_code", ["code"])

seats: defineTable({
  tableId: v.id("tables"),
  deviceId: v.string(),        // join to `devices` for current displayName + color
  seatIndex: v.number(),       // 0..N, stable across the session
  chipStack: v.number(),
  status: v.union(
    v.literal("pending_buy_in"), // joined, host hasn't bought them in yet
    v.literal("active"),
    v.literal("sitting_out"),
    v.literal("cashed_out"),
    v.literal("kicked"),
  ),
  joinedAt: v.number(),
})
  .index("by_table", ["tableId"])
  .index("by_table_and_device", ["tableId", "deviceId"])
  .index("by_table_and_seat", ["tableId", "seatIndex"])

transactions: defineTable({
  tableId: v.id("tables"),
  seatId: v.id("seats"),
  type: v.union(
    v.literal("buy_in"),
    v.literal("rebuy"),
    v.literal("cash_out"),
  ),
  amount: v.number(),          // always positive; direction implied by type
  createdAt: v.number(),
}).index("by_table", ["tableId"])

hands: defineTable({
  tableId: v.id("tables"),
  handNumber: v.number(),
  dealerSeatIndex: v.number(),
  street: v.union(
    v.literal("preflop"),
    v.literal("flop"),
    v.literal("turn"),
    v.literal("river"),
    v.literal("showdown"),
    v.literal("complete"),
  ),
  pot: v.number(),             // total chips committed across all streets
  currentBet: v.number(),      // highest bet on current street
  minRaise: v.number(),        // next legal raise increment
  toActSeatIndex: v.optional(v.number()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  voided: v.boolean(),         // true if host voided mid-hand
}).index("by_table", ["tableId"])

actions: defineTable({
  handId: v.id("hands"),
  tableId: v.id("tables"),     // denormalized for query convenience
  seatId: v.id("seats"),
  seatIndex: v.number(),       // snapshot for history rendering
  street: v.union(
    v.literal("preflop"),
    v.literal("flop"),
    v.literal("turn"),
    v.literal("river"),
  ),
  type: v.union(
    v.literal("post_sb"),
    v.literal("post_bb"),
    v.literal("check"),
    v.literal("bet"),
    v.literal("call"),
    v.literal("raise"),
    v.literal("fold"),
    v.literal("all_in"),
  ),
  amount: v.number(),          // chips committed by THIS action
  sequence: v.number(),        // monotonic per hand, server-assigned
  createdAt: v.number(),
  undone: v.boolean(),         // soft-delete so history shows the undo
  undoneAt: v.optional(v.number()),
  undoneByDeviceId: v.optional(v.string()),
})
  .index("by_hand_and_sequence", ["handId", "sequence"])
  .index("by_table", ["tableId"])

handResults: defineTable({
  handId: v.id("hands"),
  tableId: v.id("tables"),
  awards: v.array(v.object({
    seatId: v.id("seats"),
    potIndex: v.number(),      // 0 = main pot, 1+ = side pots
    amount: v.number(),
  })),
  createdAt: v.number(),
  voided: v.boolean(),         // true when host undoes the pot award; stack credits are reversed
  voidedAt: v.optional(v.number()),
}).index("by_hand", ["handId"])

stackEdits: defineTable({
  tableId: v.id("tables"),
  seatId: v.id("seats"),
  byDeviceId: v.string(),      // will be host
  before: v.number(),
  after: v.number(),
  reason: v.string(),
  createdAt: v.number(),
}).index("by_table", ["tableId"])

hostEvents: defineTable({
  tableId: v.id("tables"),
  byDeviceId: v.string(),
  type: v.union(
    v.literal("kick"),
    v.literal("transfer_host"),
    v.literal("void_hand"),
    v.literal("undo_action"),
    v.literal("end_game"),
    v.literal("edit_settings"),
  ),
  payload: v.any(),            // small JSON describing specifics
  createdAt: v.number(),
}).index("by_table", ["tableId"])
```

**Notes:**
- No `undoLog` table needed (host-only undo → mutation directly reverses).
- `actions.undone = true` preserves the record for replay/audit; queries filter by `undone == false` for live state.
- `hands.voided = true` used when a hand is abandoned mid-stream (e.g., host ends game).
- `seats.seatIndex` is assigned on join and never changes. Dealer button rotates through active seats only.

---

## 9. Real-Time Architecture

Convex's strengths carry the app:
- Every screen is `useQuery` + `useMutation`. No client-side game state.
- Reactivity is automatic: when a `seats` doc updates, all subscribed screens re-render with the new chip stack.
- Mutations are transactional. Two players can't submit conflicting actions — the one that arrives second fails validation and the client retries or shows an error.

**Per-screen queries:**

| Screen | Queries |
|---|---|
| Lobby | `getTable(code)`, `getSeats(tableId)` |
| Hand | `getTable`, `getSeats`, `getCurrentHand(tableId)`, `getActions(handId)` |
| History | `getHands(tableId)`, `getActionsForHand(handId)` on expand |
| Settle | `getTable`, `getSeats`, `getTransactions(tableId)` |

**Mutations are named by intent:** `createTable`, `joinTable`, `buyInSeat` (host), `rebuySeat` (host), `startHand`, `recordAction`, `awardPot`, `undoLastAction` (host), `editStack` (host), `voidHand` (host), `kickPlayer` (host), `cashOut`, `endGame` (host), `transferHost` (host), `sitOut`, `sitIn`, `editSettings` (host).

Both `buyInSeat` and `rebuySeat` take a target `seatId` (not implicit "self") and can only be called by the host device. They write to `transactions` with type `buy_in` or `rebuy` respectively.

**Server-side authorization on every mutation:**
- All mutations take `deviceId` as input.
- Server resolves `(tableId, deviceId)` → `seat`. If no active seat, reject.
- Host-only mutations additionally check `table.hostDeviceId === deviceId`.

**Keep-awake:** `expo-keep-awake` activated on the hand screen only.

**Reconnect:** Convex reconnects automatically. Any pending mutation retries. Action sequencing means late arrivals either succeed in order or fail validation harmlessly.

---

## 10. Game State Machine

Per hand:

```
startHand(tableId)
   → creates hands row (street=preflop, dealer rotated to next active seat clockwise)
   → posts blinds (SB, BB actions auto-recorded)
   → toActSeatIndex = UTG (first active seat left of BB).
     Heads-up (2 active seats): dealer posts SB and acts first preflop;
     on flop/turn/river, action always starts on the first active seat
     left of the dealer — which heads-up is the BB.

recordAction(handId, seatId, type, amount)
   → validates: is seat toAct? is action legal? can seat afford it?
   → records action row, updates hands.pot/currentBet/minRaise
   → advances toActSeatIndex to next active (non-folded, non-all-in) seat
   → if street closed: advance street (preflop→flop→turn→river→showdown)
   → if only one seat remains active (all others folded): jump to complete, award pot to survivor

awardPot(handId, awards)
   → writes handResults
   → credits seat chipStacks
   → sets hands.completedAt, hands.street = "complete"
   → tables.currentHandId = undefined
   → rotate dealer button for next hand

undoLastAction(handId) [host only]
   → finds last action where undone == false
   → marks undone = true
   → reverses chipStack change for that seat
   → recomputes hands.pot/currentBet/minRaise/toActSeatIndex from action stream
   → if action was a street-closer, step street back
```

**Action legality rules (enforced server-side):**
- `check`: only if `seat_committed_this_street == currentBet`
- `bet`: only if `currentBet == 0` on this street; amount ≥ bigBlind
- `raise`: only if `currentBet > 0`; raise-to amount ≥ `currentBet + minRaise`
- `call`: amount = `currentBet − seat_committed_this_street`, clamped to stack (if stack < needed, auto-convert to `all_in`)
- `fold`: always legal
- `all_in`: amount = full remaining stack; treated as call or raise based on size

---

## 11. Side Pots & Distribution

**When any player goes all-in**, pot may split. Algorithm:

1. Collect total committed per seat across the hand (sum of all non-undone actions by that seat). Call this `C(seat)`.
2. Let distinct commitment levels from all-in seats be `L₁ < L₂ < ... < Lₖ` (sorted ascending). Set `L₀ = 0`.
3. Build pot layers, from smallest to largest:
   - For each `i` in `1..k`: side pot `i` = `(Lᵢ − Lᵢ₋₁) × (number of seats with C(seat) ≥ Lᵢ)`. Eligible winners are the seats (non-folded) with `C(seat) ≥ Lᵢ`.
   - Main pot: `Σ max(0, C(seat) − Lₖ)` over all seats with `C(seat) > Lₖ` (the chips non-all-in seats bet *above* the highest all-in). Eligible winners are those seats.
4. At showdown, prompt "Who won [Pot X of Y]? [pot size]" for each pot. Award order does not affect correctness as long as each pot's eligibility is respected; UX convention is smallest side pot first, main pot last.
5. On ties: user taps multiple winners → split evenly; odd chip goes to the first eligible seat clockwise from the dealer button (standard house rule).

**Single-survivor shortcut:** if everyone else folds, all pots go to the survivor without prompting.

---

## 12. Undo & Stack Edit (Host Only)

**Undo last action:**
- Visible in hand view only to the host device.
- Reverses the most recent reversible event. Two kinds exist:
  1. **Action undo:** the last non-undone `actions` row. Mark `undone = true`, credit the committed chips back to that seat, recompute `hands.pot / currentBet / minRaise / toActSeatIndex`. If the action was a street-closer, step the street back.
  2. **Pot award undo:** if the hand is `complete` with an active (non-voided) `handResults` row, undoing that reverses the stack credits, marks `handResults.voided = true`, sets `hands.street = "showdown"`, clears `hands.completedAt`, and restores `tables.currentHandId = handId`. Further undos then revert actions one by one as above.
- Chain undo supported: tap again to undo the one before.
- All players see a toast: `Host undid: [Name]'s [action]` (or "Host undid the pot award").

**Edit stack:**
- Host taps any seat → **Edit chips**. Modal: numeric input + required reason.
- Writes `stackEdits` row and updates `seats.chipStack`.
- Visible in history log.

**Void hand:**
- Rare path. Host action from hand settings menu.
- Restores all stacks to pre-hand state, marks `hands.voided = true`, starts next hand.

---

## 13. Settlement

On end game:
1. Auto-void any active hand.
2. Auto-cash-out every still-`active` and `sitting_out` seat at current stack. `pending_buy_in` seats are ignored (no chips, no transactions, net = 0). `cashed_out` and `kicked` seats already have their cash-out transaction recorded.
3. For each seat, compute `net = sum(cash_outs) − sum(buy_ins + rebuys)` (chips).
4. Sanity check: `sum(nets) == 0`. If not (shouldn't happen, but defensive): flag with a warning banner; settlement still displays.
5. **Minimal-transfer algorithm:**
   - Separate debtors (net < 0) and creditors (net > 0).
   - Greedy: pair largest debtor with largest creditor, transfer `min(|debtor|, creditor)`, remove whoever zeroed out, repeat.
   - Produces at most N−1 transfers, typically far fewer.
6. Display: "Alice pays Bob 42 chips" list. Per-player breakdown on tap (buy-ins, cash-outs, net).
7. Share button: plain-text summary via share sheet.

---

## 14. UX & UI Principles

- **Dark mode default.** Poker night ambiance, easier on eyes, better battery.
- **Chip count is the hero.** Largest text on every screen is the relevant chip number (my stack in My view, pot in Table view).
- **Color-coded seats.** Each player's chosen color is used everywhere they appear — seat pill, action history entries, bet markers.
- **Big touch targets.** Minimum 56px height for any action button.
- **Haptics on every action.** `expo-haptics`: light impact on self-action, medium on turn arrival, success on pot won.
- **Bet input.** Large slider with snap points (min bet, ½ pot, pot, all-in) + numeric keypad override.
- **Confirmations only on destructive actions.** Fold, all-in, cash out, kick, end game. Everything else commits on tap.
- **"Whose turn" is unambiguous.** The active player's name and seat are prominent; their phone additionally pulses/vibrates.
- **Landscape:** portrait-only for MVP. V1.5 adds landscape for tablet table view.

---

## 15. Tech Stack

**Already present:** Expo SDK 54, Expo Router, Convex, Reanimated, Haptics, SafeAreaContext.

**To add for MVP:**
- `expo-secure-store` — persist `deviceId`
- `expo-keep-awake` — prevent screen sleep on hand screen
- `expo-clipboard` — copy join code

**No new Convex components for MVP.** Plain schema + queries/mutations.

**For V1.5:**
- `expo-camera` + `react-native-qrcode-svg` — QR flows
- `expo-notifications` — push for turn alerts (requires server-side Expo push via Convex scheduled action)

---

## 16. Security & Threat Model

This is a friends app, not a casino. Threat model: "Alice misclicks" and "the host's phone dies mid-hand," not "Alice cheats."

- All mutations validate caller identity via `deviceId → seat` lookup.
- Host-only mutations check `table.hostDeviceId === deviceId`.
- Join codes are 4-char uppercase alphanumeric (~1.6M combinations). On table creation, regenerate on collision against currently non-`ended` tables. Codes are not secret; lobby knowledge is enough.
- Rate-limit table creation per `deviceId` (Convex rate limiter component or simple in-schema counter) — defer to V1.5 unless abuse appears.
- No PII collected. Display names are user-chosen strings.
- All host actions logged in `hostEvents` for transparency; any player can view history.

---

## 17. Platform Targets

iOS and Android only. Web is not a target, in MVP or beyond. Native-only Expo APIs (`expo-secure-store`, `expo-haptics`, `expo-keep-awake`, etc.) are used directly without web shims.

---

## 18. Implementation Roadmap

### Phase 0 — Foundation
- Convex schema (§8)
- Device identity: generate + store `deviceId`, wrap in `useDeviceId()` hook
- Onboarding screen (name + color)
- Welcome screen with Start / Join buttons (plus "resume into active table" deep-link on open)
- Mutations: `upsertDevice`, `createTable` (seats host at seat 0), `joinTable`, `buyInSeat` (host-only)
- Lobby screen rendering seats in real-time, with host-only "Buy in" affordance per seat

### Phase 1 — Core game loop
- Mutations: `startHand` (with auto-blinds), `recordAction`, `awardPot`
- Hand state machine server-side
- Hand screen: My view with action buttons for active seat
- Table view with seat layout, pot, current bets
- Dealer button rotation
- Single-survivor pot award (the common case)

### Phase 2 — MVP completion
- Side pots (§11) — multi-layer awarding UI
- Host-only undo (§12), including pot-award undo
- Host-only stack edit
- Host-only kick
- Host-only `rebuySeat`
- Host-only `voidHand` and `transferHost`
- Player self-service: `sitOut` / `sitIn`, `cashOut`
- End game + settlement screen (§13)
- Hand history screen
- Polish pass: dark mode, haptics, keep-awake, copy code

### Phase 3 — V1.5
- Configurable blinds/buy-in at creation + mid-game
- Blind timer
- Quick-bet presets
- QR generation + scanning
- Deep-link share sheet
- Push notifications for turn

### Phase 4 — V2
- Tournament mode
- Identity upgrade (passkey/email)
- Cross-session stats
- Payment app deep links

---

## 19. Non-Goals (Explicit)

Things PokerStacks will **not** do, to keep scope honest:

- **Deal or track cards.** The physical deck is the deck. App never knows hole cards.
- **Enforce poker hand rankings.** Humans decide the winner; app distributes the pot.
- **Online play.** This is an in-person-only tool. No remote tables.
- **Real-money transactions.** App tracks chip counts and suggests payments; actual money moves through Venmo/cash/etc. off-app.
- **Moderation / fair play enforcement.** Trust lives at the table.
- **Cross-table stats or leaderboards (MVP).** Deferred to V2 after identity upgrade.
- **Spectator mode.** Anyone at the table has a seat.
- **Web.** iOS/Android only — no web build, ever.

---

## 20. Open Questions (Resolved)

Resolved during design discussion:

- **Action recording:** each player records their own actions. Host-only undo.
- **Join method (MVP):** invite code only. No QR until V1.5.
- **Currency:** chips only. 1 chip = 1 betting unit. Default 200 chips, 1 SB, 2 BB; configurable later but schema carries these fields from day one.
- **Host powers:** buy in / rebuy any seat, kick, force-end, undo, edit stacks, edit settings, transfer host. Host is the banker — every stack increase goes through them. All other actions (own bets, cash out, sit out) are self-service.
- **History:** store everything (every action, transaction, stack edit, host event) forever. Never store card data.
- **Web:** never. iOS/Android only.

No further open questions blocking Phase 0.
