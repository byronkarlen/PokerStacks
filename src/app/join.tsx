import { api } from "@/convex/_generated/api";
import { useMe } from "@/hooks/useMe";
import { colors, typography } from "@/theme";
import { useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const CODE_LEN = 4;

// Must mirror convex/games.ts: CODE_ALPHABET (letters-only, ambiguous
// chars excluded). We validate client-side so users can't type a digit
// or I/L/O and get a "not found" surprise.
const VALID_CHARS = /^[ABCDEFGHJKMNPQRSTUVWXYZ]*$/;

export default function Join() {
  const router = useRouter();
  const me = useMe();
  const userId = me?._id;
  const joinTable = useMutation(api.games.joinGame);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const ready = code.length === CODE_LEN && !!userId && !busy;

  function handleChange(raw: string) {
    const cleaned = raw.toUpperCase().slice(0, CODE_LEN);
    if (!VALID_CHARS.test(cleaned)) return;
    setCode(cleaned);
    setError(null);
  }

  async function handleJoin() {
    if (!ready || !userId) return;
    setBusy(true);
    setError(null);
    try {
      const { code: actualCode } = await joinTable({
        code: code.trim(),
      });
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      router.replace(`/table/${actualCode}/lobby`);
    } catch (e) {
      // Convex wraps thrown errors in a verbose message — substring-match the
      // signal we care about and surface a short friendly line.
      const raw = e instanceof Error ? e.message : "";
      let friendly: string;
      if (/not found/i.test(raw)) {
        friendly = "No game with that code.";
      } else if (/ended/i.test(raw)) {
        friendly = "That game already ended.";
      } else {
        friendly = "Couldn't join. Try again.";
      }
      setError(friendly);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Warning,
      ).catch(() => {});
      // Keep the typed code so the user can edit — editing any char clears
      // the error via handleChange.
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const boxes = [0, 1, 2, 3].map((i) => {
    const filled = i < code.length;
    const active = i === code.length && code.length < CODE_LEN;
    return (
      <View
        key={i}
        style={[
          styles.codeBox,
          filled && styles.codeBoxFilled,
          active && styles.codeBoxActive,
        ]}
      >
        <Text style={styles.codeChar}>{code[i] ?? ""}</Text>
      </View>
    );
  });

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>Join table</Text>
          <Text style={styles.title}>Enter table code.</Text>
        </View>

        <Pressable
          style={styles.codeWrap}
          onPress={() => inputRef.current?.focus()}
        >
          <View style={styles.codeBoxes}>{boxes}</View>
        </Pressable>

        {/* Invisible input that drives the code state */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={handleChange}
          style={styles.hiddenInput}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          caretHidden
          maxLength={CODE_LEN}
          keyboardType="ascii-capable"
          keyboardAppearance="dark"
          returnKeyType="join"
          onSubmitEditing={handleJoin}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={{ flex: 1 }} />

        <View style={styles.footer}>
          <Pressable
            onPress={handleJoin}
            disabled={!ready}
            style={[styles.cta, !ready && styles.ctaDisabled]}
          >
            <Text style={styles.ctaText}>{busy ? "Joining…" : "Join"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const BOX_W = 62;
const BOX_H = 82;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  titleBlock: {
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.6,
    color: colors.gold,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 42,
    lineHeight: 44,
    color: colors.ivory,
    letterSpacing: -0.5,
    marginTop: 10,
  },
  codeWrap: {
    marginTop: 40,
    alignItems: "center",
  },
  codeBoxes: {
    flexDirection: "row",
    gap: 12,
  },
  codeBox: {
    width: BOX_W,
    height: BOX_H,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(201,169,97,0.3)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  codeBoxFilled: {
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  codeBoxActive: {
    borderColor: colors.gold,
    shadowColor: colors.gold,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  codeChar: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 42,
    color: colors.gold,
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: "center",
    marginTop: 16,
    paddingHorizontal: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  cta: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
