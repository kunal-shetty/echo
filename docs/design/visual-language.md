# Visual Language

This document describes the design system and UX principles that define the look and feel of Echo.

## Overview
Echo's design is centered around "Tactile Minimalism"—combining a clean, dark aesthetic with high-energy animations and high-precision colors.

## Color System (OKLCH)
Echo uses the `oklch` color space instead of RGB or HEX. This allows for consistent perceived brightness and more vibrant "neon" tones.

### Palette
- **Background**: Deep midnight (`oklch(0.13 0.025 255)`).
- **Primary (Emerald)**: The core "action" color (`oklch(0.78 0.17 160)`), used for the Mic button and success states.
- **Tones**: Each category has a distinct tone for instant visual recognition:
    - `Violet`: Shopping / Entertainment.
    - `Orange`: Food / Dining.
    - `Blue`: Transport / Bills.
    - `Emerald`: Income / Health.

## Motion & Animation
Motion is used to provide "physicality" to the interface.

### Key Patterns
- **The Orb**: The voice capture indicator uses concentric rings and a pulse animation to indicate it is "listening."
- **The Pill**: The active navigation item is highlighted by a sliding pill (`layoutId="nav-pill"`) that glides between items.
- **Spring Physics**: All transitions use spring physics (stiffness 400, damping 24) rather than linear eases to feel more responsive and organic.
- **View Transitions**: Using the View Transition API to anchor the header across screen swaps, preventing jarring jumps.

## Layout Principles
- **Thumb-Zone Optimization**: All critical actions (Voice Button, Save, Edit) are placed in the bottom half of the screen for easy one-handed use.
- **Contextual Sheets**: Instead of full-page navigation, Echo uses Bottom Sheets for capture and editing, keeping the user in their current context.
