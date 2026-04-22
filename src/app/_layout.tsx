import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export default function RootLayout() {
  return (
    <ConvexAuthProvider client={convex} storage={secureStorage}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            gestureEnabled: false,
            animation: "none",
          }}
        >
          <Stack.Screen
            name="onboarding"
            options={{ gestureEnabled: true, animation: "default" }}
          />
          <Stack.Screen
            name="join"
            options={{ gestureEnabled: true, animation: "default" }}
          />
        </Stack>
      </SafeAreaProvider>
    </ConvexAuthProvider>
  );
}
