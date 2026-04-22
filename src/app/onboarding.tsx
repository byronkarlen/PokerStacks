import { api } from "@/convex/_generated/api";
import { useMe } from "@/hooks/useMe";
import { colors, typography } from "@/theme";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
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

export default function Onboarding() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const me = useMe();
  const setDisplayName = useMutation(api.users.setDisplayName);
  const createTable = useMutation(api.games.createGame);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  // After signIn, the Convex client needs a tick for its WebSocket auth to
  // refresh. Firing createGame synchronously after `await signIn(...)` races
  // with that refresh and the mutation hits the server as unauthenticated.
  // Park the post-signIn `next` here and let an effect fire once auth has
  // actually propagated (isAuthenticated true AND `me` resolved).
  const [pendingNext, setPendingNext] = useState<string | null>(null);
  const ranPendingRef = useRef(false);

  // Pre-fill when editing an existing name.
  useEffect(() => {
    if (me?.displayName) setName(me.displayName);
  }, [me?.displayName]);

  useEffect(() => {
    if (!pendingNext || !isAuthenticated || !me || ranPendingRef.current) {
      return;
    }
    ranPendingRef.current = true;
    const target = pendingNext;
    (async () => {
      try {
        if (target === "create") {
          const { code } = await createTable({});
          router.replace(`/table/${code}/lobby`);
        } else {
          router.replace(target as "/join");
        }
      } finally {
        setSavingName(false);
      }
    })();
  }, [pendingNext, isAuthenticated, me, createTable, router]);

  // Wait until `me` has resolved one way or the other — otherwise we can't
  // tell "editing existing user" from "stale token whose user was deleted".
  const canSubmit =
    name.trim().length > 0 &&
    !savingName &&
    pendingNext === null &&
    me !== undefined;

  async function handleContinue() {
    if (!canSubmit) return;
    setSavingName(true);
    const trimmed = name.trim();
    try {
      // Edit mode only when BOTH the token is valid AND the user row exists.
      // A stale token (e.g. DB was wiped since last launch) presents as
      // isAuthenticated=true with me=null — we must re-sign-in in that case.
      if (isAuthenticated && me) {
        await setDisplayName({ displayName: trimmed });
        if (!next) {
          router.back();
        } else if (next === "create") {
          const { code } = await createTable({});
          router.replace(`/table/${code}/lobby`);
        } else {
          router.replace(next as "/join");
        }
        setSavingName(false);
      } else {
        // Stale token? Drop the old session before signing in fresh so the
        // server isn't left with an orphaned session referencing a dead user.
        if (isAuthenticated) {
          await signOut();
        }
        await signIn("anonymous", { displayName: trimmed });
        if (!next) {
          router.back();
          setSavingName(false);
        } else {
          // Wait for auth to propagate. Effect above finishes the flow.
          setPendingNext(next);
        }
      }
    } catch {
      setSavingName(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.inner}>
          <Text style={styles.title}>Before you sit.</Text>
          <Text style={styles.subtitle}>
            What should we call you at the table?
          </Text>

          <View style={styles.nameSection}>
            <Text style={styles.kicker}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder=""
              style={styles.input}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              selectionColor={colors.gold}
              keyboardAppearance="dark"
              autoFocus
            />
          </View>

          <View style={{ flex: 1 }} />

          <Pressable
            onPress={handleContinue}
            disabled={!canSubmit}
            style={[styles.cta, !canSubmit && styles.ctaDisabled]}
          >
            <Text style={styles.ctaText}>{next ? "Continue" : "Save"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 24,
  },
  title: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 44,
    lineHeight: 46,
    color: colors.ivory,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.mute,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
    maxWidth: 280,
  },
  nameSection: {
    marginTop: 48,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.6,
    color: colors.gold,
    textTransform: "uppercase",
  },
  input: {
    marginTop: 12,
    paddingVertical: 16,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairStrong,
    backgroundColor: "transparent",
    color: colors.ivory,
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 38,
  },
  cta: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
