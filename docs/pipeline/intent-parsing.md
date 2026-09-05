# Intent Parsing Pipeline

This document describes the second stage of the Echo pipeline: transforming a raw text transcript into a structured, actionable financial intent.

## Overview
Echo leverages the Groq LLM (Llama-3) to perform Named Entity Recognition (NER) and Intent Classification on the user's transcript.

## Technical Flow
1. **Request**: The `app/api/voice-intent/route.ts` receives the transcript.
2. **Contextualization**: The system attaches "Context" to the LLM prompt:
    - **Current Time**: Resolves relative terms like "yesterday" or "last month".
    - **Recent History**: The last 5 transactions are provided so the LLM can identify "Update" or "Delete" targets (e.g., "Change the lunch entry").
3. **LLM Processing (`lib/groq.ts`)**:
    - The LLM is instructed to return a **STRICT JSON** object.
    - It classifies the action: `create`, `update`, `delete`, or `query`.
4. **Entity Extraction**:
    - **Amount**: Normalized to a number (e.g., "twelve fifty" $\rightarrow$ 12.5).
    - **Merchant**: Title-cased and stripped of filler words.
    - **Category**: Mapped to the closest match from a predefined set (e.g., "coffee" $\rightarrow$ "Food & Drink").
    - **Date**: Converted to ISO 8601.

## Intent Schema
The LLM emits a JSON object following this structure:
```json
{
  "action": "create" | "update" | "delete" | "query",
  "amount": number | null,
  "merchant": string | null,
  "direction": "expense" | "income" | null,
  "category": string | null,
  "transacted_at": string | null,
  "match": { "id": string } | null,
  "confidence": number
}
```

## Accuracy & Confidence
The system uses a `confidence` score (0..1) to decide the UI flow:
- **High Confidence ($\ge 0.7$)**: Auto-saves the transaction.
- **Medium Confidence ($0.3 - 0.7$)**: Shows a confirmation card.
- **Low Confidence ($< 0.3$)**: Redirects to the manual entry form.
