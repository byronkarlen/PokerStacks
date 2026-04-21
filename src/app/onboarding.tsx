import { api } from "@/convex/_generated/api";
import { saveDisplayName, useDisplayName } from "@/hooks/useDisplayName";
import { saveUserId, useUserId } from "@/hooks/useUserId";
import { colors, typography } from "@/theme";
import { useMutation } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
  const userId = useUserId();
  const existingName = useDisplayName();
  const upsertUser = useMutation(api.users.upsertUser);
  const createTable = useMutation(api.tables.createTable);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Pre-fill when editing an existing name.
  useEffect(() => {
    if (existingName) setName(existingName);
  }, [existingName]);

  const canSubmit =
    name.trim().length > 0 && userId !== undefined && !savingName;

  async function handleContinue() {
    if (!canSubmit) return;
    setSavingName(true);
    try {
      const trimmed = name.trim();
      const resolvedUserId = await upsertUser({
        userId: userId ?? undefined,
        displayName: trimmed,
      });
      await saveUserId(resolvedUserId);
      await saveDisplayName(trimmed);
      if (!next) {
        router.back();
      } else if (next === "create") {
        const { code } = await createTable({ userId: resolvedUserId });
        router.replace(`/table/${code}/lobby`);
      } else {
        router.replace(next as "/join");
      }
    } finally {
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
  note: {
    marginTop: 16,
    color: colors.mute,
    fontSize: 13,
    lineHeight: 19,
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
