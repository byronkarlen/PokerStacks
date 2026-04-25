import { colors } from "@/theme";
import { Pressable, StyleSheet, Text } from "react-native";

// The big "Fold / Check / Call / Bet / Raise" buttons in the action dock.
// Tone drives the accent color so a glance tells you which action is which:
//   fold  → muted red
//   call  → muted green ("call" and "check" share this tone)
//   raise → gold
//
// When `disabled` is true we drop the tone-specific color and fall back to a
// neutral grey treatment. Opacity alone isn't enough — a 40%-alpha red button
// still reads as "red", which is the wrong affordance.
export function ActionButton({
  label,
  onPress,
  tone,
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone: "fold" | "call" | "raise";
  disabled?: boolean;
}) {
  const toneStyle = disabled
    ? styles.btnInactive
    : tone === "fold"
      ? styles.btnFold
      : tone === "call"
        ? styles.btnCall
        : styles.btnRaise;
  const textStyle = disabled
    ? styles.textInactive
    : tone === "fold"
      ? styles.textFold
      : tone === "call"
        ? styles.textCall
        : styles.textRaise;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        toneStyle,
        pressed && styles.btnPressed,
      ]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

// Shorter "x3" / "½ Pot" / "All in" sizing shortcuts under the bet slider.
export function QuickButton({
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
        styles.quickBtn,
        pressed && styles.btnPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.quickBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
  },
  btnFold: {
    backgroundColor: "rgba(201,72,72,0.1)",
    borderWidth: 1,
    borderColor: "rgba(201,72,72,0.5)",
  },
  textFold: { color: colors.text, fontSize: 15, fontWeight: "700" },
  btnCall: {
    backgroundColor: "rgba(90,168,120,0.1)",
    borderWidth: 1,
    borderColor: "rgba(90,168,120,0.5)",
  },
  textCall: { color: colors.text, fontSize: 15, fontWeight: "700" },
  btnRaise: {
    backgroundColor: "rgba(201,169,97,0.1)",
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.5)",
  },
  textRaise: { color: colors.text, fontSize: 15, fontWeight: "700" },
  // Disabled: neutral, dim, no accent — clearly "unavailable" rather than
  // "tinted but faded".
  btnInactive: {
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  textInactive: { color: colors.mute, fontSize: 15, fontWeight: "700" },
  btnPressed: { opacity: 0.55 },
  disabled: { opacity: 0.4 },

  quickBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.hairStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
