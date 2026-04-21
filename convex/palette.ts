// Color palette keys used when assigning a fresh color to a new seat.
// Mirrors the client-side PALETTE in src/theme.ts.
const COLOR_KEYS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
];

export function pickRandomColor(): string {
  return COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
}

// Pick a color not already used at the table. Falls back to a random key
// if every palette color is taken (>8 seats — rare).
export function pickRandomColorExcluding(used: Set<string>): string {
  const available = COLOR_KEYS.filter((c) => !used.has(c));
  if (available.length === 0) return pickRandomColor();
  return available[Math.floor(Math.random() * available.length)];
}
