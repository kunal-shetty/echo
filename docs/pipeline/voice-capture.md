# Voice Capture Pipeline

This document describes the first stage of the Echo pipeline: converting user speech into a text transcript.

## Overview
Echo uses the browser's native Web Speech API (via a custom hook) to capture audio in real-time, providing immediate visual feedback to the user.

## Technical Flow
1. **Trigger**: The user holds the `VoiceButton` in the `BottomNav` or triggers it via the `VoiceSheet`.
2. **Capture**: The `useSpeech` hook initializes the `SpeechRecognition` interface.
3. **Real-time Processing**:
    - As the user speaks, `onResult` events provide interim transcripts.
    - These interim transcripts are passed to the `VoiceSheet` to show "Echo is listening..." and the live text.
4. **Finalization**:
    - The browser detects a pause in speech (endpointing).
    - The `onFinal` callback is triggered with the complete transcript.
5. **Handoff**: The final transcript is sent to the `/api/voice-intent` endpoint to begin the parsing phase.

## Key Components
- **`useSpeech` Hook**: Manages the lifecycle of the `SpeechRecognition` object, handling browser compatibility and error states.
- **`VoiceButton`**: Implements a "hold-to-trigger" gesture, reducing accidental activations.
- **`VoiceSheet`**: Provides the visual "Orb" that pulses during capture, creating a tactile feel for the voice interaction.

## Error Handling
- **Permission Denied**: If the user blocks mic access, a fallback state informs the user to enable permissions in browser settings.
- **No Speech Detected**: After a timeout, the system reverts to a "listening" state or offers manual entry.
