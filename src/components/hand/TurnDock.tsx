import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { colors } from "@/theme";
import Slider from "@react-native-community/slider";
import { useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { SeatWithProfile } from "../table/SeatPill";
import { ActionButton, QuickButton } from "./ActionButtons";
import {
  BettingRules,
  computeBettingRules,
  potTargetForFraction,
} from "./bettingRules";

type Hand = Doc<"hands">;
type Action = Doc<"actions">;
type ActionType = "check" | "call" | "fold" | "all_in" | "bet" | "raise";

// The bottom dock during normal betting streets. Header shows "Your turn" or
// "{Player}'s turn"; tap or swipe down on the header to collapse the body.
//
// Body content depends on whose turn it is:
//   - my turn: Fold / Check-or-Call / Bet-or-Raise buttons + bet sizer
//   - someone else's turn: a single "Fold" button to AFK-fold for them
//     (anyone at the table can fold for whoever's stalling — common house
//      rule for in-person play)
export function TurnDock({
  table,
  hand,
  actions,
  mySeat,
  toActSeat,
  isMyTurn,
}: {
  table: Doc<"games">;
  hand: Hand;
  actions: Action[];
  mySeat: SeatWithProfile | null;
  toActSeat: SeatWithProfile;
  isMyTurn: boolean;
}) {
  const recordAction = useMutation(api.hands.recordAction);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const rules = useMemo(
    () => computeBettingRules({ hand, actions, mySeat, bigBlind: table.bigBlind }),
    [hand, actions, mySeat, table.bigBlind],
  );

  const headerPanResponder = useDockHeaderPan(setCollapsed);

  async function fire(
    type: ActionType,
    opts?: { amount?: number; onBehalfOf?: Id<"seats"> },
  ) {
    setError(null);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await recordAction({
        handId: hand._id,
        type,
        amount: opts?.amount,
        onBehalfOf: opts?.onBehalfOf,
      });
      // Stays open by default — user controls collapse via the header.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const turnHeader = isMyTurn ? "Your turn" : `${toActSeat.displayName}'s turn`;

  return (
    <Animated.View style={styles.dock} layout={LinearTransition}>
      <View style={styles.header} {...headerPanResponder.panHandlers}>
        <View style={styles.dragHandle} />
        <Text style={styles.headerText}>{turnHeader}</Text>
      </View>

      {!collapsed ? (
        <View style={styles.body}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {isMyTurn && mySeat ? (
            <MyTurnControls
              table={table}
              hand={hand}
              rules={rules}
              busy={busy}
              fire={fire}
            />
          ) : (
            <AfkFoldRow
              busy={busy}
              hasMySeat={!!mySeat}
              onFold={() => fire("fold", { onBehalfOf: toActSeat._id })}
            />
          )}
        </View>
      ) : null}
    </Animated.View>
  );
}

// -----------------------------------------------------------------------------
// Drag handle on the dock header
// -----------------------------------------------------------------------------

// Swipe down → collapse, swipe up → expand, tap → toggle. Attached to a
// plain View — Pressable's own responder system would swallow the pan.
function useDockHeaderPan(setCollapsed: (v: boolean | ((c: boolean) => boolean)) => void) {
  return useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 4 || Math.abs(g.dx) > 4,
      onPanResponderRelease: (_, g) => {
        const SWIPE_THRESHOLD = 16;
        const TAP_TOLERANCE = 6;
        if (g.dy > SWIPE_THRESHOLD) setCollapsed(true);
        else if (g.dy < -SWIPE_THRESHOLD) setCollapsed(false);
        else if (Math.abs(g.dy) < TAP_TOLERANCE && Math.abs(g.dx) < TAP_TOLERANCE) {
          setCollapsed((c) => !c);
        }
      },
    }),
  ).current;
}

// -----------------------------------------------------------------------------
// My-turn body: action buttons + bet sizer
// -----------------------------------------------------------------------------

function MyTurnControls({
  table,
  hand,
  rules,
  busy,
  fire,
}: {
  table: Doc<"games">;
  hand: Hand;
  rules: BettingRules;
  busy: boolean;
  fire: (
    type: ActionType,
    opts?: { amount?: number; onBehalfOf?: Id<"seats"> },
  ) => void;
}) {
  const {
    callAmount,
    canCheck,
    canCall,
    canBet,
    canRaise,
    canBetOrRaise,
    canAggress,
    clampedMin,
    maxTarget,
  } = rules;

  // Bet-sizing target driven by the slider + quick buttons.
  const [target, setTarget] = useState(clampedMin);
  // Reset whenever the legal range changes (street change / new hand /
  // someone bet, raising the floor).
  useEffect(() => {
    setTarget(clampedMin);
  }, [hand._id, hand.street, hand.currentBet, clampedMin]);

  const raiseLabel = canBet
    ? `Bet ${target}`
    : canRaise
      ? `Raise to ${target}`
      : "All-in";

  function handleAggress() {
    // Short all-ins (target equals maxTarget but below minRaise) must go
    // through "all_in" — server rejects "raise" amounts under minRaise.
    if (canBetOrRaise && target >= maxTarget) fire("all_in");
    else if (canBet) fire("bet", { amount: target });
    else if (canRaise) fire("raise", { amount: target });
    else fire("all_in");
  }

  return (
    <>
      <View style={styles.actionRow}>
        {!canCheck ? (
          <ActionButton
            label="Fold"
            tone="fold"
            onPress={() => fire("fold")}
            disabled={busy}
          />
        ) : null}
        {canCheck ? (
          <ActionButton
            label="Check"
            tone="call"
            onPress={() => fire("check")}
            disabled={busy}
          />
        ) : (
          <ActionButton
            label={`Call ${callAmount}`}
            tone="call"
            onPress={() => fire("call")}
            disabled={busy || !canCall}
          />
        )}
        {canAggress ? (
          <ActionButton
            label={raiseLabel}
            tone="raise"
            onPress={handleAggress}
            disabled={busy}
          />
        ) : null}
      </View>

      {canBetOrRaise && clampedMin < maxTarget ? (
        <BetSizer
          target={target}
          setTarget={setTarget}
          rules={rules}
          hand={hand}
          smallBlind={table.smallBlind}
          bigBlind={table.bigBlind}
          busy={busy}
        />
      ) : null}
    </>
  );
}

// -----------------------------------------------------------------------------
// Bet sizer: slider, +/- step buttons, quick-size shortcuts.
// -----------------------------------------------------------------------------

function BetSizer({
  target,
  setTarget,
  rules,
  hand,
  smallBlind,
  bigBlind,
  busy,
}: {
  target: number;
  setTarget: (v: number | ((t: number) => number)) => void;
  rules: BettingRules;
  hand: Hand;
  smallBlind: number;
  bigBlind: number;
  busy: boolean;
}) {
  const { clampedMin, maxTarget, myStreetCommit } = rules;

  const clampToLegalRange = (v: number) =>
    Math.max(clampedMin, Math.min(maxTarget, Math.round(v * 2) / 2));

  // Preflop-specific shortcuts: open-raise multipliers (x3, x5) of the BB
  // (or of the current bet, e.g. when 3-betting). Postflop uses pot-relative
  // sizes which feel more natural once there's a real pot built.
  const isPreflop = hand.street === "preflop";
  const multiplierBase = hand.currentBet > 0 ? hand.currentBet : bigBlind;

  return (
    <>
      <View style={styles.sliderRow}>
        <StepButton
          label="−"
          onPress={() => setTarget((t) => clampToLegalRange(t - smallBlind))}
          disabled={busy}
        />
        <Slider
          style={styles.slider}
          minimumValue={clampedMin}
          maximumValue={maxTarget}
          step={bigBlind}
          value={target}
          onValueChange={(v) => setTarget(Math.round(v))}
          minimumTrackTintColor={colors.gold}
          maximumTrackTintColor={colors.hairStrong}
          thumbTintColor={colors.gold}
          disabled={busy}
        />
        <StepButton
          label="+"
          onPress={() => setTarget((t) => clampToLegalRange(t + smallBlind))}
          disabled={busy}
        />
      </View>
      <View style={styles.quickRow}>
        {isPreflop ? (
          <>
            <QuickButton
              label="x3"
              onPress={() => setTarget(clampToLegalRange(multiplierBase * 3))}
              disabled={busy}
            />
            <QuickButton
              label="x5"
              onPress={() => setTarget(clampToLegalRange(multiplierBase * 5))}
              disabled={busy}
            />
          </>
        ) : (
          <>
            <QuickButton
              label="½ Pot"
              onPress={() =>
                setTarget(
                  clampToLegalRange(
                    potTargetForFraction({ hand, myStreetCommit, fraction: 0.5 }),
                  ),
                )
              }
              disabled={busy}
            />
            <QuickButton
              label="¾ Pot"
              onPress={() =>
                setTarget(
                  clampToLegalRange(
                    potTargetForFraction({ hand, myStreetCommit, fraction: 0.75 }),
                  ),
                )
              }
              disabled={busy}
            />
          </>
        )}
        <QuickButton
          label="Pot"
          onPress={() =>
            setTarget(
              clampToLegalRange(
                potTargetForFraction({ hand, myStreetCommit, fraction: 1 }),
              ),
            )
          }
          disabled={busy}
        />
        <QuickButton
          label="All in"
          onPress={() => setTarget(maxTarget)}
          disabled={busy}
        />
      </View>
    </>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.stepBtn,
        pressed && styles.btnPressed,
      ]}
      hitSlop={4}
    >
      <Text style={styles.stepBtnText}>{label}</Text>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// Not-my-turn body: AFK fold for whoever's stalling.
// -----------------------------------------------------------------------------

function AfkFoldRow({
  busy,
  hasMySeat,
  onFold,
}: {
  busy: boolean;
  hasMySeat: boolean;
  onFold: () => void;
}) {
  return (
    <View style={styles.actionRow}>
      <ActionButton
        label="Fold"
        tone="fold"
        onPress={onFold}
        disabled={busy || !hasMySeat}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    marginHorizontal: 12,
    marginTop: 20,
    marginBottom: 16,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.25)",
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    alignItems: "center",
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairStrong,
    marginBottom: 10,
  },
  headerText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 6,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.hairStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 22,
  },
  btnPressed: { opacity: 0.55 },
  quickRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  error: {
    color: colors.danger,
    marginVertical: 8,
    textAlign: "center",
    fontSize: 14,
  },
});
