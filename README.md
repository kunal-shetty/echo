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
- **Inference Engine:** Powered by **Groq** for ultra-fast LLM responses.
- **Zero-Shot Intent Classification:** Natural language is classified into `create`, `update`, `delete`, or `query` intents in real-time.
- **Deterministic Extraction:** Strict JSON schema enforcement ensures unstructured voice logs (e.g., *"Spent 500 bucks on dinner with team"*) are transformed into type-safe database records.
- **Contextual Memory:** The parser is fed recent transaction history, allowing it to resolve references like *"change the last one to 600"* or *"delete that blinkit order"*.

### 3. Data Layer
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
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key   # server-only; never expose
   OTP_PEPPER=a_long_random_secret                    # required in production
   RESEND_API_KEY=your_resend_key                     # optional: email sync
   RESEND_FROM="Echo <codes@yourdomain.com>"          # optional: email sync
   ```
4. Apply the database schema (idempotent; re-run after pulling changes):
   ```bash
   psql "$SUPABASE_DB_URL" -f schema.sql
   ```
   or paste `schema.sql` into the Supabase SQL Editor.
5. Run the development server:
   ```bash
   npm run dev
   ```

### Testing
```bash
npm test                  # unit + API route tests (Vitest)
npx playwright install    # once, to download browsers
npm run test:e2e          # end-to-end tests; starts `next dev` automatically
```
