import { api } from "@/convex/_generated/api";
import { theme } from "@/lib/colors";
import { useDeviceId } from "@/lib/deviceId";
import { useMutation } from "convex/react";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const DEFAULT_BUY_IN = 200;
const DEFAULT_SB = 1;
const DEFAULT_BB = 2;

export default function Create() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const createTable = useMutation(api.tables.createTable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!deviceId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { code } = await createTable({ deviceId });
      router.replace(`/table/${code}/lobby`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create table");
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: "" }} />
      <View style={styles.inner}>
        <Text style={styles.title}>New game</Text>
        <Text style={styles.subtitle}>Defaults — you can change later.</Text>

        <View style={styles.settingsBox}>
          <Setting label="Buy-in" value={`${DEFAULT_BUY_IN} chips`} />
          <Setting label="Small blind" value={`${DEFAULT_SB} chip`} />
          <Setting label="Big blind" value={`${DEFAULT_BB} chips`} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={handleCreate}
          disabled={!deviceId || busy}
          style={[styles.cta, (!deviceId || busy) && styles.ctaDisabled]}
        >
          <Text style={styles.ctaText}>{busy ? "Creating…" : "Create table"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
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
  settingsBox: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  settingLabel: { color: theme.textMuted, fontSize: 16 },
  settingValue: { color: theme.text, fontSize: 16, fontWeight: "600" },
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
