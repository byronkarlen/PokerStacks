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
            headerShown: false,
            gestureEnabled: true,
          }}
        >
          <Stack.Screen
            name="table/[code]/lobby"
            options={{
              gestureEnabled: false,
              animation: "none",
            }}
          />
          <Stack.Screen
            name="table/[code]/hand"
            options={{ gestureEnabled: false }}
          />
          <Stack.Screen
            name="table/[code]/history"
            options={{ gestureEnabled: false }}
          />
          <Stack.Screen
            name="table/[code]/settle"
            options={{ gestureEnabled: false }}
          />
        </Stack>
      </SafeAreaProvider>
    </ConvexProvider>
  );
}
