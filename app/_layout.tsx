import { theme } from "@/lib/colors";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export default function RootLayout() {
  return (
    <ConvexProvider client={convex}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.bg },
            headerTintColor: theme.text,
            contentStyle: { backgroundColor: theme.bg },
            headerShown: false,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="join" />
          <Stack.Screen name="create" />
          <Stack.Screen name="table/[code]/lobby" />
          <Stack.Screen name="table/[code]/hand" />
          <Stack.Screen name="table/[code]/history" />
          <Stack.Screen name="table/[code]/settle" />
        </Stack>
      </SafeAreaProvider>
    </ConvexProvider>
  );
}
