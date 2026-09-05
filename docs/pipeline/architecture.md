# Echo Architecture Documentation

Echo is a voice-first financial companion designed for rapid capture and intelligent analysis of expenses and income.

## Table of Contents

### 🚀 The Voice Pipeline
Detailed documentation of the "Voice-to-Action" flow.
- [Voice Capture](./pipeline/voice-capture.md) - How speech is captured.
- [Intent Parsing](./pipeline/intent-parsing.md) - How LLMs transform text to JSON.
- [Action Execution](./pipeline/action-execution.md) - How the DB is updated.
- [UI Feedback Loop](./pipeline/ui-feedback-loop.md) - How the user sees the results.

### 💾 Data & Storage
The foundation of Echo's financial ledger.
- [Data Schema](./data/schema.md) - Tables, types, and minor units.
- [Storage Strategy](./data/storage-strategy.md) - Local vs. Cloud providers.

### 🔑 Identity & Sync
How users are identified and data is moved.
- [Authentication Flow](./identity/auth-flow.md) - OTP and session management.
- [Sync & Migration](./identity/sync-migration.md) - Merging guest data to cloud.

### 🎨 Design System
The visual and tactile language of the app.
- [Visual Language](./design/visual-language.md) - OKLCH colors and Motion physics.

---

## High-Level Overview

Echo follows a modern full-stack architecture using Next.js for the frontend and API layers, and Supabase (PostgreSQL) for the data layer.

### Tech Stack
- **Frontend**: Next.js (App Router), React 19, Tailwind CSS, Lucide React.
- **Animations**: Motion (formerly Framer Motion).
- **Backend**: Next.js Serverless Functions (Node.js runtime).
- **Database**: Supabase (PostgreSQL).
- **AI/LLM**: Groq (Llama-3 models) for intent parsing and reasoning.
- **Identity**: Device-based identity with optional email-based synchronization.
