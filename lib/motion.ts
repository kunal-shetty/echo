// Shared motion presets. Tuned for Echo's "calm, intelligent" feel:
// a little spring, slightly slower than snappy, never bouncy.
//
// Keep durations in the 150–400ms range. Anything > 500ms feels laggy on
// a phone app; anything < 120ms feels like a glitch.

import type { Transition, Easing } from "motion/react";

export const EASE_OUT: Easing = [0.16, 1, 0.3, 1]; // expo-out
export const EASE_IN_OUT: Easing = [0.65, 0, 0.35, 1];
export const EASE_SHEET: Easing = [0.32, 0.72, 0, 1]; // decel — feels native

export const SPRING_SHEET: Transition = {
  type: "spring",
  damping: 32,
  stiffness: 320,
  mass: 0.8,
};

export const SPRING_GENTLE: Transition = {
  type: "spring",
  damping: 22,
  stiffness: 220,
  mass: 0.9,
};

export const SPRING_SNAPPY: Transition = {
  type: "spring",
  damping: 24,
  stiffness: 380,
  mass: 0.6,
};

export const FADE: Transition = {
  duration: 0.22,
  ease: EASE_OUT,
};

export const SLIDE_UP: Transition = {
  duration: 0.32,
  ease: EASE_SHEET,
};

export const NAV_PILL: Transition = {
  type: "spring",
  damping: 26,
  stiffness: 360,
  mass: 0.5,
};
