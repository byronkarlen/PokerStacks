import { api } from "@/convex/_generated/api";
import { theme } from "@/lib/colors";
import { useDeviceId } from "@/lib/deviceId";
import { useProfile } from "@/lib/profile";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Index() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const profile = useProfile();

  // Skip query while we don't have an id (it would be invalid args).
  const activeTable = useQuery(
    api.tables.getMyActiveTable,
    deviceId ? { deviceId } : "skip",
  );

  // Send users with no profile straight to onboarding.
  useEffect(() => {
    if (profile === null) {
      router.replace("/onboarding");
    }
  }, [profile, router]);

  // Resume an in-progress game.
  useEffect(() => {
    if (!activeTable) return;
    const { table } = activeTable;
    if (table.status === "lobby") {
      router.replace(`/table/${table.code}/lobby`);
    } else if (table.status === "active") {
      router.replace(`/table/${table.code}/hand`);
    }
  }, [activeTable, router]);

  // Loading state: device, profile, or active-table query still pending.
  if (deviceId === null || profile === undefined || activeTable === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={theme.text} />
      </SafeAreaView>
    );
  }

  // Profile null → onboarding redirect already firing; render placeholder.
  if (profile === null) {
    return <SafeAreaView style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.title}>PokerStacks</Text>
          <Text style={styles.greeting}>Hi, {profile.displayName}.</Text>
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={() => router.push("/create")}
          style={[styles.cta, styles.ctaPrimary]}
        >
          <Text style={styles.ctaText}>Start a game</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push("/join")}
          style={[styles.cta, styles.ctaSecondary]}
        >
          <Text style={[styles.ctaText, { color: theme.text }]}>Join a game</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push("/onboarding")}
          style={styles.editProfile}
        >
          <Text style={styles.editProfileText}>Edit name &amp; color</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  inner: {
    flex: 1,
    width: "100%",
    padding: 24,
  },
  header: {
    paddingTop: 32,
  },
  title: {
    color: theme.text,
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  greeting: {
    color: theme.textMuted,
    fontSize: 18,
    marginTop: 8,
  },
  cta: {
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  ctaPrimary: {
    backgroundColor: theme.accent,
  },
  ctaSecondary: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
  },
  ctaText: {
    color: theme.bg,
    fontSize: 18,
    fontWeight: "700",
  },
  editProfile: {
    alignSelf: "center",
    paddingVertical: 14,
    marginTop: 8,
  },
  editProfileText: {
    color: theme.textMuted,
    fontSize: 14,
  },
});
