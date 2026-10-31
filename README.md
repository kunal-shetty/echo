# 🎙️ Echo — Multimodal Voice AI Finance Assistant

**The fastest, most intuitive way to track your finances using voice.**

> **👉 [WATCH THE 5-MINUTE PITCH AND DEMO VIDEO HERE](LINK)**

Echo is an end-to-end multimodal finance intelligence pipeline that transforms raw voice input into structured financial records in under 2 seconds. By combining local processing with high-performance cloud inference, Echo eliminates the friction of manual expense tracking.

---

## 🚀 Core Value Proposition

Traditional expense tracking fails because of **manual friction**. Echo solves this by treating voice as the primary interface, leveraging a hybrid AI architecture to ensure near-instant response times and deterministic data accuracy.

### 🎯 Objectives
- **Eliminate Legacy Friction:** Replaces tedious form-filling with natural conversation.
- **Solve the Latency Problem:** Optimized pipeline keeps round-trip time $< 2s$.
- **Reduce Compute Costs:** Hybrid processing reduces reliance on expensive cloud LLMs for simple tasks.
- **Ensure Data Integrity:** Atomic persistence and transactional state management prevent data corruption.

---

## 🛠️ Technical Architecture

Echo uses a sophisticated **2-Layer Processing Pipeline** to balance speed and intelligence.

### 1. The Fast Path (Edge/Local)
- **Voice Capture:** High-fidelity audio sampling.
- **Transcription:** Local-first processing (Whisper Base) to convert speech to text without network round-trips.
- **TTS:** Low-latency voice synthesis (Piper) for natural, immediate feedback.

### 2. The Intelligence Path (Cloud Inference)
- **Inference Engine:** Powered by **Groq** for ultra-fast LLM responses, orchestrated with **LangChain** (prompt → model → output-parser chains, with Pydantic-validated intents).
- **Zero-Shot Intent Classification:** Natural language is classified into `create`, `update`, `delete`, or `query` intents in real-time.
- **Deterministic Extraction:** Strict JSON schema enforcement ensures unstructured voice logs (e.g., *"Spent 500 bucks on dinner with team"*) are transformed into type-safe database records.
- **Contextual Memory:** The parser is fed recent transaction history, allowing it to resolve references like *"change the last one to 600"* or *"delete that blinkit order"*.

### 3. Application Layout
- **Frontend:** Next.js + React (`app/`, `components/`, `lib/`).
- **Backend:** Python **FastAPI** (`backend/`) serves every `/api/*` route. Next.js proxies `/api/*` to it (`next.config.ts`), so the browser talks to one origin and the session cookie stays first-party.

### 4. Data Layer
- **Database:** Supabase (PostgreSQL) with transactional states.
- **Merchant Intelligence:** A custom alias system that learns and canonicalizes merchant names (e.g., *"Zomato"*, *"Zomato Ltd"*, *"Zomato App"* $\rightarrow$ `Zomato`).

---

## 📊 Build Challenges & Solutions

| Challenge | Solution |
| :--- | :--- |
| **High Conversational Latency** | Architected a hybrid pipeline. Local audio processing $\rightarrow$ Groq Cloud Inference. Total round-trip $< 2s$. |
| **Unstructured Voice Logs** | Deployed zero-shot intent classification and strict JSON schema validation for atomic record creation. |
| **State Management** | Implemented transactional database states to handle partial failures and network drops gracefully. |
| **Merchant Ambiguity** | Engineered a merchant-alias resolution layer to maintain clean, canonical financial logs. |

---

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+
- Supabase Project
- Groq API Key

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/echo.git
   cd echo
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your `.env` file:
   ```env
   GROQ_API_KEY=your_groq_key
   GROQ_MODEL=qwen/qwen3.8-27b                        # optional: chat model override
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key   # server-only; never expose
   OTP_PEPPER=a_long_random_secret                    # required in production
   RESEND_API_KEY=your_resend_key                     # optional: email sync
   RESEND_FROM="Echo <codes@yourdomain.com>"          # optional: email sync
   APP_ENV=production                                 # production only: secure cookies, required OTP_PEPPER
   BACKEND_URL=http://127.0.0.1:8000                  # optional: where Next proxies /api/*
   ```
   The backend reads the same `.env` / `.env.local` from the repo root.
4. Apply the database schema (idempotent; re-run after pulling changes):
   ```bash
   psql "$SUPABASE_DB_URL" -f schema.sql
   ```
   or paste `schema.sql` into the Supabase SQL Editor.
5. Install the Python backend (a virtualenv is recommended):
   ```bash
   python -m venv backend/.venv
   source backend/.venv/bin/activate    # Windows: backend\.venv\Scripts\activate
   pip install -e "backend[dev]"
   ```
6. Run the backend and the frontend, each in its own terminal (with the virtualenv active for the backend):
   ```bash
   npm run dev:api    # FastAPI on :8000 (API docs at http://localhost:8000/api/docs)
   npm run dev        # Next.js on :3000, proxying /api/* to FastAPI
   ```

### Testing
```bash
npm run test:api          # backend unit + API route tests (pytest)
npm test                  # frontend component tests (Vitest)
npx playwright install    # once, to download browsers
npm run test:e2e          # end-to-end tests; starts FastAPI and `next dev` automatically
```

## 📱 Android app & voice agent

The Android app (`android/`, built with Capacitor) loads the running Next.js
server, so the UI and `/api/*` stay the same. On top of the web app it adds:

- **Haptics:** taps on buttons, plus distinct buzzes for saved, check-this and failed. You can turn them off in App settings.
- **Notifications:** a daily memory nudge (morning/evening) scheduled on the phone, and replies from the agent.
- **An always-on voice agent you can name** (Profile → Voice agent). A background service listens offline for the name using Vosk (`vosk-model-small-en-in-0.4`, downloaded once, ~37 MB). Audio leaves the phone only after the name is heard. The command is then sent to `POST /api/agent/turn`, which transcribes it, acts on it or answers it. The agent speaks the result, vibrates and posts a notification. "Teach it your name" records how the recognizer hears unusual names.

Requirements: Android Studio's SDK, JDK 21, and a phone with USB debugging on.

```bash
npm run dev:api                     # FastAPI on :8000
npm run dev                         # Next on :3000

# Let the phone reach your machine (find your LAN IP with ipconfig)
DEV_ORIGINS=192.168.1.20 npm run dev
CAP_SERVER_URL=http://192.168.1.20:3000 npm run android:sync

npm run android:run                 # install and launch on the connected phone
npm run android:apk                 # or build android/app/build/outputs/apk/debug/app-debug.apk
npm run test:android                # wake-word matcher unit tests
```

Open the app once so it has a session, then turn on Profile → Voice agent.
Set Echo's battery use to "Unrestricted" so Android doesn't stop the agent.
Android only lets an app start the microphone service while the app is open.
So if the phone reboots or the system kills the agent, it posts a notification asking you to reopen Echo.
iOS doesn't allow background wake-word listening, so the agent is Android-only.

## ☁️ Deploying on Vercel

Echo is deployed as two Vercel projects from this one repo:

| Project | URL | Root Directory | Framework |
|---|---|---|---|
| Frontend (Next.js) | https://echomoney.vercel.app | `.` | Next.js |
| Backend (FastAPI) | https://echomoneyapi.vercel.app | `backend` | FastAPI (detected from `pyproject.toml`) |

The browser and the Android app only talk to the frontend. It forwards
`/api/*` to the backend, so the session cookie stays on `echomoney.vercel.app`
and no CORS setup is needed.

**Frontend environment variables**

- `BACKEND_URL=https://echomoneyapi.vercel.app`
- `ECHO_PROXY_SECRET` is a long random string, the same in both projects. Vercel replaces the visitor's IP on the request to the backend, so the frontend passes it along with this secret. Without it, every user would share one rate limit.

**Backend environment variables**

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM` (plus `GROQ_MODEL` if you override it).
- `APP_ENV=production`, which turns on secure cookies and requires `OTP_PEPPER`.
- `OTP_PEPPER`
- `ECHO_PROXY_SECRET`, with the same value as the frontend.

The Android app loads `https://echomoney.vercel.app` by default (see `capacitor.config.ts`).
