// Web implementation: localStorage. Picked by Metro when bundling for web.
export async function getItem(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}
