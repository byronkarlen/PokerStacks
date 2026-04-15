import { api } from "@/convex/_generated/api";
import { theme } from "@/lib/colors";
import { useDeviceId } from "@/lib/deviceId";
import { useMutation } from "convex/react";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const CODE_LEN = 4;

export default function Join() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const joinTable = useMutation(api.tables.joinTable);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = code.trim().length === CODE_LEN && deviceId !== null && !busy;

  async function handleJoin() {
    if (!ready || !deviceId) return;
    setBusy(true);
    setError(null);
    try {
      const { code: actualCode } = await joinTable({
        deviceId,
        code: code.trim().toUpperCase(),
      });
      router.replace(`/table/${actualCode}/lobby`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join");
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: "" }} />
      <View style={styles.inner}>
        <Text style={styles.title}>Join a game</Text>
        <Text style={styles.subtitle}>Enter the 4-letter code from the host.</Text>

        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().slice(0, CODE_LEN))}
          placeholder="ABCD"
          placeholderTextColor={theme.border}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CODE_LEN}
          returnKeyType="join"
          onSubmitEditing={handleJoin}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={handleJoin}
          disabled={!ready}
          style={[styles.cta, !ready && styles.ctaDisabled]}
        >
          <Text style={styles.ctaText}>{busy ? "Joining…" : "Join"}</Text>
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
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    color: theme.text,
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: 12,
    paddingHorizontal: 18,
    paddingVertical: 18,
    textAlign: "center",
  },
  error: {
    color: theme.danger,
    marginTop: 16,
    fontSize: 14,
  },
  cta: {
    backgroundColor: theme.accent,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: theme.bg, fontSize: 18, fontWeight: "700" },
});
