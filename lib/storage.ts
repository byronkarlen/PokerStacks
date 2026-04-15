// Native (iOS/Android) implementation. Web has its own override at storage.web.ts.
import * as SecureStore from "expo-secure-store";

export async function getItem(key: string): Promise<string | null> {
  return await SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
