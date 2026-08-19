// Fixed lucide-react icon vocabulary Echo allows for category icons.
// Seeded system categories use a subset of these (`schema.sql:538-546`).
// We keep this list flat so both server validation and the UI picker
// can import the same source of truth.

export const ICON_VOCAB = [
  // 7 seeded system categories
  "UtensilsCrossed",
  "ShoppingBasket",
  "Car",
  "Music",
  "ShoppingBag",
  "Receipt",
  "Package",
  // Common additions for user-created categories
  "Home",
  "Pill",
  "Fuel",
  "Plane",
  "Train",
  "Coffee",
  "Utensils",
  "Baby",
  "Dog",
  "HeartPulse",
] as const;

export type IconName = (typeof ICON_VOCAB)[number];

export function isIconName(name: string): name is IconName {
  return (ICON_VOCAB as readonly string[]).includes(name);
}
