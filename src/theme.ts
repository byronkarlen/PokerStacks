// Per-player avatar color palette. Kept independent of the theme colors —
// these are user identity colors, not UI chrome.
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

// "Classy Felt" design tokens — the only palette the app uses.
// Warm dark felt with gold accent, ivory display type.
export const colors = {
  bg: "#0b1410",
  surface: "#152921",
  raised: "#1b3529",
  hair: "rgba(201,169,97,0.16)",
  hairStrong: "rgba(201,169,97,0.3)",
  text: "#f3ece0",
  mute: "#8a9890",
  gold: "#c9a961",
  ivory: "#f5ecd9",
  danger: "#c94848",
};

export const typography = {
  serif: "Georgia",
};
