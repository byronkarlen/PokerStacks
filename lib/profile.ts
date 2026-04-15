import { useEffect, useState } from "react";
import { getItem, setItem } from "./storage";

const NAME_KEY = "pokerstacks.displayName";
const COLOR_KEY = "pokerstacks.color";

export type Profile = {
  displayName: string;
  color: string;
};

export async function loadProfile(): Promise<Profile | null> {
  const [displayName, color] = await Promise.all([
    getItem(NAME_KEY),
    getItem(COLOR_KEY),
  ]);
  if (!displayName || !color) return null;
  return { displayName, color };
}

export async function saveProfile(profile: Profile): Promise<void> {
  await Promise.all([
    setItem(NAME_KEY, profile.displayName),
    setItem(COLOR_KEY, profile.color),
  ]);
}

/**
 * Returns the cached profile, or `undefined` while loading, or `null` if not set.
 */
export function useProfile(): Profile | null | undefined {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadProfile().then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return profile;
}
