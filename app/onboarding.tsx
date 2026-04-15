import { api } from "@/convex/_generated/api";
import { PALETTE, theme } from "@/lib/colors";
import { useDeviceId } from "@/lib/deviceId";
import { saveProfile, useProfile } from "@/lib/profile";
import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Onboarding() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const profile = useProfile();
  const upsertDevice = useMutation(api.devices.upsertDevice);

  const [name, setName] = useState("");
  const [colorKey, setColorKey] = useState<string>(PALETTE[0].key);
  const [busy, setBusy] = useState(false);

  // Pre-fill if profile exists (editing later, or returning user).
  useEffect(() => {
    if (profile) {
      setName(profile.displayName);
      setColorKey(profile.color);
    }
  }, [profile]);

  const canSubmit = name.trim().length > 0 && deviceId !== null && !busy;

  async function handleContinue() {
    if (!canSubmit || !deviceId) return;
    setBusy(true);
    try {
      const trimmed = name.trim();
      await upsertDevice({
        deviceId,
        displayName: trimmed,
        color: colorKey,
      });
      await saveProfile({ displayName: trimmed, color: colorKey });
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.inner}>
        <Text style={styles.title}>Welcome</Text>
        <Text style={styles.subtitle}>Pick a name and color.</Text>

        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Alex"
          placeholderTextColor={theme.textMuted}
          style={styles.input}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />

        <Text style={styles.label}>Color</Text>
        <View style={styles.swatchRow}>
          {PALETTE.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setColorKey(c.key)}
              style={[
                styles.swatch,
                { backgroundColor: c.hex },
                colorKey === c.key && styles.swatchSelected,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Color ${c.key}`}
              accessibilityState={{ selected: colorKey === c.key }}
            />
          ))}
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={handleContinue}
          disabled={!canSubmit}
          style={[styles.cta, !canSubmit && styles.ctaDisabled]}
        >
          <Text style={styles.ctaText}>Continue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  inner: { flex: 1, padding: 24 },
  title: { color: theme.text, fontSize: 32, fontWeight: "700" },
  subtitle: {
    color: theme.textMuted,
    fontSize: 16,
    marginTop: 4,
    marginBottom: 32,
  },
  label: {
    color: theme.textMuted,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.text,
    fontSize: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 4,
  },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: "transparent",
  },
  swatchSelected: {
    borderColor: theme.text,
  },
  cta: {
    backgroundColor: theme.accent,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    color: theme.bg,
    fontSize: 18,
    fontWeight: "700",
  },
});
