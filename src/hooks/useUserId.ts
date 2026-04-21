import { Id } from "@/convex/_generated/dataModel";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const KEY = "pokerstacks.userId";

const subscribers = new Set<(id: Id<"users"> | null) => void>();

export async function loadUserId(): Promise<Id<"users"> | null> {
  const stored = await AsyncStorage.getItem(KEY);
  return stored as Id<"users"> | null;
}

export async function saveUserId(id: Id<"users">): Promise<void> {
  await AsyncStorage.setItem(KEY, id);
  subscribers.forEach((s) => s(id));
}

/**
 * Returns the locally-stored user id, `undefined` while loading, or
 * `null` if the user hasn't onboarded yet. Updates when `saveUserId` fires.
 */
export function useUserId(): Id<"users"> | null | undefined {
  const [userId, setUserId] = useState<Id<"users"> | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let cancelled = false;
    loadUserId().then((id) => {
      if (!cancelled) setUserId(id);
    });
    const subscriber = (id: Id<"users"> | null) => {
      if (!cancelled) setUserId(id);
    };
    subscribers.add(subscriber);
    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
    };
  }, []);
  return userId;
}
