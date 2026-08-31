/**
 * @file icon-vocab.ts
 * @description Fixed vocabulary of Lucide-react icon names allowed for categories.
 * This list is shared between server-side validation and the frontend icon picker.
 */

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

/** Type representing a valid icon name from the vocabulary. */
export type IconName = (typeof ICON_VOCAB)[number];

/**
 * Validates if a given string is a supported icon name.
 * @param name The icon name to check.
 * @returns True if the name is in the ICON_VOCAB.
 */
export function isIconName(name: string): name is IconName {
  return (ICON_VOCAB as readonly string[]).includes(name);
}
