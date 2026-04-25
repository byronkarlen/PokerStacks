import { api } from "@/convex/_generated/api";
import { useMe } from "@/hooks/useMe";
import { colors, typography } from "@/theme";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Set once we've completed the auth + active-game gating below. The logo
// splash on this screen exists to bridge the native launch splash on cold
// start; on any subsequent navigation back to `/` (e.g. settle → Done) the
// gate has already run, so we skip it and render home immediately.
let hasInitialized = false;

export default function Index() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const me = useMe();
  const createGame = useMutation(api.games.createGame);
  const convex = useConvex();
  const [creatingTable, setCreatingTable] = useState(false);
  const [checkingForActiveTable, setCheckingForActiveTable] = useState(
    !hasInitialized,
  );

  // Resume an in-progress game if one exists. One-shot read so we don't
  // stay subscribed. Guarded by the module-level `hasInitialized` flag so
  // it only runs the first time `/` is reached this session — repeated
  // navigations back to home (e.g. from the settle screen) skip the splash.
  useEffect(() => {
    if (hasInitialized) return;
    if (authLoading) return;
    if (!isAuthenticated) {
      hasInitialized = true;
      setCheckingForActiveTable(false);
      return;
    }
    let cancelled = false;
    convex.query(api.games.getMyActiveGame).then((result) => {
      if (cancelled) return;
      hasInitialized = true;
      if (result?.game.status === "lobby") {
        router.replace(`/table/${result.game.code}/lobby`);
      } else if (result?.game.status === "active") {
        router.replace(`/table/${result.game.code}/hand`);
      } else {
        setCheckingForActiveTable(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, router, convex]);


  if (authLoading || me === undefined || checkingForActiveTable) {
    // Logo-only landing — visually continuous with the native splash so the
    // transition from launch to first screen doesn't blink.
    return (
      <SafeAreaView style={styles.loading}>
        <Image
          source={require("../../assets/images/icon.png")}
          style={styles.loadingLogo}
          resizeMode="contain"
        />
      </SafeAreaView>
    );
  }

  const displayName = me?.displayName ?? null;
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  async function handleStartGame() {
    if (creatingTable) return;
    if (!isAuthenticated || !displayName) {
      router.push({ pathname: "/onboarding", params: { next: "create" } });
      return;
    }
    setCreatingTable(true);
    try {
      const { code } = await createGame({});
      // Push (not replace) so home stays below lobby in the stack — lets
      // Cancel pop back with the correct left-to-right animation.
      router.push(`/table/${code}/lobby`);
    } finally {
      setCreatingTable(false);
    }
  }

  function handleJoinGame() {
    if (isAuthenticated && displayName) router.push("/join");
    else router.push({ pathname: "/onboarding", params: { next: "/join" } });
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {displayName ? (
        <>
          <View style={styles.greetBlock}>
            <Text style={styles.greetLine}>Good {timeOfDay},</Text>
            <Pressable
              onPress={() => router.push("/onboarding")}
              hitSlop={12}
            >
              <Text style={[styles.greetLine, styles.greetName]}>
                {displayName}.
              </Text>
            </Pressable>
            <Text style={styles.greetSub}>
              Ready to deal? Start a table or join one with a code.
            </Text>
          </View>
          <View style={{ flex: 1 }} />
        </>
      ) : (
        <>
          <View style={{ flex: 1 }} />
          <View style={styles.markBlock}>
            <Text style={styles.markPoker}>Poker</Text>
            <Text style={styles.markStacks}>STACKS</Text>
            <Text style={styles.markSub}>
              Home poker, digitized tastefully.
            </Text>
          </View>
          <View style={{ flex: 1 }} />
        </>
      )}

      <View style={styles.ctaBlock}>
        <Pressable
          onPress={handleStartGame}
          disabled={creatingTable}
          style={[styles.ctaPrimary, creatingTable && { opacity: 0.6 }]}
        >
          <Text style={styles.ctaPrimaryText}>
            {creatingTable ? "Starting…" : "Start a game"}
          </Text>
        </Pressable>
        <Pressable onPress={handleJoinGame} style={styles.ctaSecondary}>
          <Text style={styles.ctaSecondaryText}>Join with a code</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingLogo: {
    // Matches the native splash `imageWidth: 360` in app.json so there's no
    // jump in size when the splash hides and this screen takes over.
    width: 360,
    height: 360,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  greetBlock: {
    paddingHorizontal: 24,
    paddingTop: 64,
  },
  greetLine: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 44,
    lineHeight: 46,
    color: colors.ivory,
    letterSpacing: -0.5,
  },
  greetName: {
    color: colors.gold,
  },
  greetSub: {
    color: colors.mute,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
    maxWidth: 260,
  },
  markBlock: {
    paddingHorizontal: 32,
    alignItems: "flex-start",
  },
  markPoker: {
    fontFamily: typography.serif,
    fontStyle: "italic",
    fontSize: 64,
    lineHeight: 64,
    color: colors.gold,
    letterSpacing: -1,
  },
  markStacks: {
    fontSize: 40,
    fontWeight: "800",
    color: colors.ivory,
    letterSpacing: -1.5,
    lineHeight: 40,
    marginTop: -4,
  },
  markSub: {
    marginTop: 18,
    fontSize: 14,
    lineHeight: 20,
    color: colors.mute,
    maxWidth: 280,
  },
  ctaBlock: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  ctaPrimary: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaPrimaryText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  ctaSecondary: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairStrong,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaSecondaryText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
});
