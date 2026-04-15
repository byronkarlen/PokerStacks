import { useEffect, useState } from "react";
import { getItem, setItem } from "./storage";

const KEY = "pokerstacks.deviceId";

// RFC 4122 v4 UUID. Math.random is fine here — this is an opaque identifier,
// not a security token.
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getItem(KEY);
  if (existing) return existing;
  const fresh = uuidv4();
  await setItem(KEY, fresh);
  return fresh;
}

/**
 * Returns the device's persistent anonymous identifier.
 * Returns `null` while loading on first render; never null after that.
 */
export function useDeviceId(): string | null {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getOrCreateDeviceId().then((id) => {
      if (!cancelled) setDeviceId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return deviceId;
}
