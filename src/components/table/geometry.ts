// Shared layout for the oval poker table used by lobby + hand screens.
//
// "Me" sits at the bottom of the oval (angle = π/2) and everyone else
// rotates around clockwise from there. All pixel values below are in the
// `tableArea` coordinate space (a fixed-size View that holds the oval and
// every absolutely-positioned child sitting on it).

// Outer bounds of the table area (the box that contains everything on the felt).
export const TABLE_W = 340;
export const TABLE_H = 440;

// Seat-pill orbit radii. Pills sit on the perimeter of an ellipse with these
// half-widths/heights — narrower than the table itself so the pills hug the
// felt rather than the screen edge.
export const SEAT_RX = 125;
export const SEAT_RY = 200;

// Seat pill (the small chip showing avatar + chip stack).
export const PILL_W = 78;
export const PILL_H = 28;

// Bet chip pill (gold poker-chip icon + amount, sits on the felt rail).
export const BET_CHIP_H = 22;
// The bet chip is centered inside this fixed-width anchor so amounts of any
// length ("1" vs "999") visually center on the same point.
export const BET_ANCHOR_W = 60;

// Hole cards peek above each seat pill — we reuse community-card dimensions
// so all face-down cards on the felt read as one deck.
export const COMMUNITY_CARD_W = 16;
export const COMMUNITY_CARD_H = 22;
export const HOLE_CARD_W = COMMUNITY_CARD_W;
export const HOLE_CARD_H = COMMUNITY_CARD_H;

// Dealer button ("B") chip.
export const DEALER_BTN_SIZE = 16;

// -----------------------------------------------------------------------------
// Position helpers
// -----------------------------------------------------------------------------

// Returns the top-left corner of the seat pill at `index` (in the seats array)
// when there are `total` seats and the local user sits at `meIndex`.
export function seatPosition(
  index: number,
  total: number,
  meIndex: number,
): { left: number; top: number } {
  const angle = ((index - meIndex) / total) * Math.PI * 2 + Math.PI / 2;
  const cx = TABLE_W / 2;
  const cy = TABLE_H / 2;
  return {
    left: cx + SEAT_RX * Math.cos(angle) - PILL_W / 2,
    top: cy + SEAT_RY * Math.sin(angle) - PILL_H / 2,
  };
}

// Bet chip anchor (top-left). Top-half seats: chip below the pill. Bottom-half
// seats: chip above the pill (clearing the hole cards) so it doesn't push past
// the bottom edge of the table area.
export function betPosition(
  index: number,
  total: number,
  meIndex: number,
): { left: number; top: number } {
  const angle = ((index - meIndex) / total) * Math.PI * 2 + Math.PI / 2;
  const cx = TABLE_W / 2;
  const cy = TABLE_H / 2;
  const pillCx = cx + SEAT_RX * Math.cos(angle);
  const pillCy = cy + SEAT_RY * Math.sin(angle);
  const isBottomHalf = pillCy > cy;
  const top = isBottomHalf
    ? pillCy - PILL_H / 2 - (HOLE_CARD_H - 4) - BET_CHIP_H - 4
    : pillCy + PILL_H / 2 + 4;
  return {
    left: pillCx - BET_ANCHOR_W / 2,
    top,
  };
}

// Dealer button position — anchored to the bottom-right of the seat pill,
// overhanging by 5px on both sides (matches the in-pill placement we used
// before lifting the button out for animation).
export function dealerButtonPosition(
  index: number,
  total: number,
  meIndex: number,
): { left: number; top: number } {
  const seatPos = seatPosition(index, total, meIndex);
  return {
    left: seatPos.left + PILL_W - DEALER_BTN_SIZE + 5,
    top: seatPos.top + PILL_H - DEALER_BTN_SIZE + 5,
  };
}
