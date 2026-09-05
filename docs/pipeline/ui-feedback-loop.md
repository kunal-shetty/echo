# UI Feedback Loop

This document describes the final stage of the Echo pipeline: communicating the result of the voice action back to the user through the `VoiceSheet`.

## Overview
The `VoiceSheet` is a state-machine based component that transitions through different views based on the progress of the pipeline.

## State Transitions
The UI flows through these states:

1. **Listening State**:
    - Triggered when the mic is active.
    - Shows the "Orb" pulsing and live interim transcripts.
2. **Parsing State**:
    - Triggered when the transcript is sent to the API.
    - Shows "Echo is parsing..." with a loading animation.
3. **Confirm State**:
    - Triggered when the LLM confidence is medium ($0.3 - 0.7$).
    - Displays a card with the parsed amount and merchant.
    - User can "Remember this" (Confirm) or "Edit manually" (Switch to Manual).
4. **Answer State**:
    - Triggered by "Query" intents.
    - Displays the reasoned response and a list of relevant transactions.
    - Includes a "Replay" button to trigger Text-to-Speech (TTS).
5. **Manual State**:
    - Triggered by low confidence ($< 0.3$) or user request.
    - Provides a full form for precise editing.

## Feedback Mechanisms
- **TTS (Text-to-Speech)**: When an answer is generated, Echo speaks the response using the `useSpeechSynth` hook.
- **Toast Notifications**: On successful auto-save, a toast appears at the bottom of the screen (e.g., "Saved · Lunch").
- **Visual Cues**: The "Orb" changes color and pulse speed based on the state (Listening vs. Parsing).
