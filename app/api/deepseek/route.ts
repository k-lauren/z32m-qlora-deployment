// app/api/deepseek/route.ts
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export const runtime = "nodejs";
// Give the function enough time on Vercel (effective limit depends on your plan)
export const maxDuration = 120;

const HF_ENDPOINT =
  "https://fcnqv2fo42h3klpx.us-east-1.aws.endpoints.huggingface.cloud";

const SYSTEM_PROMPT = `
You are an information extraction and counting engine.

Your task is to read the user's text and count how many distinct sentences express each of the following 10 values:
Universalism, Benevolence, Conformity, Tradition, Security, Power, Achievement, Pleasure, Stimulation, Self-Direction.

Definitions:
- A sentence may contribute to multiple values.
- Count each sentence at most once per value.
- If a value is not expressed in any sentence, its count is 0.
- The maximum possible score for any value is the total number of sentences in the text.

Output ONLY valid JSON that matches the required schema exactly.
Do not include explanations, reasoning, or additional keys.
Do not include markdown or commentary.

Schema (must match exactly):
{
  "scores": {
    "universalism": 0,
    "benevolence": 0,
    "conformity": 0,
    "tradition": 0,
    "security": 0,
    "power": 0,
    "achievement": 0,
    "pleasure": 0,
    "stimulation": 0,
    "self_direction": 0
  },
  "confidence": {
    "universalism": 0.00,
    "benevolence": 0.00,
    "conformity": 0.00,
    "tradition": 0.00,
    "security": 0.00,
    "power": 0.00,
    "achievement": 0.00,
    "pleasure": 0.00,
    "stimulation": 0.00,
    "self_direction": 0.00
  }
}

Formatting rules:
- All scores must be non-negative integers.
- All confidence values must be numbers in the range [0.00, 1.00] with exactly two decimal places.
- Output only the JSON object, with no text before or after.
`.trim();

function buildPrompt(userText: string) {
  return `${SYSTEM_PROMPT}\n\nUser text: ${JSON.stringify(userText)}`;
}

function extractGeneratedText(data: any): string {
  // Common HF endpoint shapes:
  // 1) [{ generated_text: "..." }]
  // 2) { generated_text: "..." }
  // 3) { outputs: "..." } or { output: "..." }
  // 4) { choices: [{ text: "..." }] } (OpenAI-compat layers)
  if (Array.isArray(data) && typeof data?.[0]?.generated_text === "string") {
    return data[0].generated_text;
  }
  if (typeof data?.generated_text === "string") return data.generated_text;
  if (typeof data?.outputs === "string") return data.outputs;
  if (typeof data?.output === "string") return data.output;
  if (typeof data?.choices?.[0]?.text === "string") return data.choices[0].text;
  return "";
}

function stripEchoedPrompt(full: string, prompt: string): string {
  let out = full ?? "";
  if (out.startsWith(prompt)) out = out.slice(prompt.length);
  return out.replace(/^\s+/, "");
}

/**
 * Extract the first top-level JSON object from a string via balanced braces outside strings.
 */
function extractFirstJsonObject(s: string): string | null {
  const text = s ?? "";
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    } else {
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;

      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

export async function POST(req: Request) {
  const { text } = await req.json().catch(() => ({ text: "" }));

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Missing or invalid text" }, { status: 400 });
  }

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server missing HUGGINGFACE_API_KEY" },
      { status: 500 }
    );
  }

  const prompt = buildPrompt(text);

  // Abort HF call before Vercel kills the function (prevents "POST ---" in logs)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 110_000);

  let hfResp: Response;
  try {
    hfResp = await fetch(HF_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          do_sample: false,
          temperature: 0.0,
          top_p: 1.0,
          max_new_tokens: 280,
          return_full_text: false,
        },
      }),
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAbort = err?.name === "AbortError";
    return NextResponse.json(
      {
        error: isAbort ? "HF request timed out" : "HF request failed",
        details: String(err?.message ?? err),
      },
      { status: isAbort ? 504 : 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!hfResp.ok) {
    const details = await hfResp.text().catch(() => "");
    return NextResponse.json(
      { error: "HF endpoint error", status: hfResp.status, details },
      { status: 502 }
    );
  }

  const data = await hfResp.json();
  const raw = extractGeneratedText(data) || "";

  if (!raw) {
    return NextResponse.json(
      {
        error: "No generated text found in HF response",
        returned_keys: Object.keys(data ?? {}),
      },
      { status: 502 }
    );
  }

  // Clean: remove prompt echo, then isolate first JSON object if needed
  let cleaned = stripEchoedPrompt(raw, prompt);
  const jsonSlice = extractFirstJsonObject(cleaned);
  if (jsonSlice) cleaned = jsonSlice;

  // Parse JSON for jsonb; keep parse_error if invalid
  let outputJson: any = null;
  let parse_error: string | null = null;
  try {
    outputJson = JSON.parse(cleaned);
  } catch (e: any) {
    parse_error = String(e?.message ?? e);
  }

  const modelLabel = "hf-inference-endpoint";

  // Insert and RETURNING to confirm DB write (or capture db_error)
  let db: { id: any; created_at: any } | null = null;
  let db_error: string | null = null;

  try {
    const result = await sql`
      insert into value_extractions (input_text, output_json, model)
      values (${text}, ${outputJson}, ${modelLabel})
      returning id, created_at
    `;
    db = (result?.rows?.[0] as any) ?? null;
  } catch (err: any) {
    db_error = String(err?.message ?? err);
  }

  // Always return a diagnostic envelope so the UI can show what's happening
  return NextResponse.json({
    output: cleaned,
    parse_error, // null if JSON parsed ok
    db,          // {id, created_at} if insert succeeded
    db_error,    // null if insert succeeded
  });
}
