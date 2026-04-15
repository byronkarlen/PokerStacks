// Player color palette and shared theme tokens.

export const PALETTE: { key: string; hex: string }[] = [
  { key: "red", hex: "#ef4444" },
  { key: "orange", hex: "#f97316" },
  { key: "yellow", hex: "#eab308" },
  { key: "green", hex: "#22c55e" },
  { key: "cyan", hex: "#06b6d4" },
  { key: "blue", hex: "#3b82f6" },
  { key: "purple", hex: "#a855f7" },
  { key: "pink", hex: "#ec4899" },
];

export function colorHex(key: string): string {
  const found = PALETTE.find((c) => c.key === key);
  return found?.hex ?? "#94a3b8"; // slate fallback
}

// Dark-mode-first theme.
export const theme = {
  bg: "#0a0a0a",
  surface: "#171717",
  surfaceElevated: "#262626",
  border: "#404040",
  text: "#fafafa",
  textMuted: "#a3a3a3",
  accent: "#22c55e",
  danger: "#ef4444",
  warning: "#eab308",
};
