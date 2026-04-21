import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const KEY = "pokerstacks.displayName";

const subscribers = new Set<(name: string | null) => void>();

export async function loadDisplayName(): Promise<string | null> {
  return await AsyncStorage.getItem(KEY);
}

export async function saveDisplayName(name: string): Promise<void> {
  await AsyncStorage.setItem(KEY, name);
  subscribers.forEach((s) => s(name));
}

/**
 * Returns the user's stored display name, `undefined` while loading, or
 * `null` if not set. Automatically updates when `saveDisplayName` fires.
 */
export function useDisplayName(): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadDisplayName().then((n) => {
      if (!cancelled) setName(n);
    });
    const subscriber = (n: string | null) => {
      if (!cancelled) setName(n);
    };
    subscribers.add(subscriber);
    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
    };
  }, []);
  return name;
}
