/**
 * @file motion.ts
 * @description Shared motion presets for Echo's animations.
 * Designed for a "calm, intelligent" feel: slight spring, slower than snappy,
 * and never bouncy.
 */

import type { Transition, Easing } from "motion/react";

/** Expo-out easing: starts fast and decelerates quickly. */
export const EASE_OUT: Easing = [0.16, 1, 0.3, 1];
/** Standard in-out ease. */
export const EASE_IN_OUT: Easing = [0.65, 0, 0.35, 1];
/** Deceleration ease, designed to feel native to mobile sheets. */
export const EASE_SHEET: Easing = [0.32, 0.72, 0, 1];

/** Spring transition for bottom sheets. */
export const SPRING_SHEET: Transition = {
  type: "spring",
  damping: 32,
  stiffness: 320,
  mass: 0.8,
};

/** Subtle, gentle spring transition. */
export const SPRING_GENTLE: Transition = {
  type: "spring",
  damping: 22,
  stiffness: 220,
  mass: 0.9,
};

/** Fast, snappy spring transition. */
export const SPRING_SNAPPY: Transition = {
  type: "spring",
  damping: 24,
  stiffness: 380,
  mass: 0.6,
};

/** Standard fade transition. */
export const FADE: Transition = {
  duration: 0.22,
  ease: EASE_OUT,
};

/** Smooth slide-up transition. */
export const SLIDE_UP: Transition = {
  duration: 0.32,
  ease: EASE_SHEET,
};

/** Springy animation for navigation pill indicators. */
export const NAV_PILL: Transition = {
  type: "spring",
  damping: 26,
  stiffness: 360,
  mass: 0.5,
};
