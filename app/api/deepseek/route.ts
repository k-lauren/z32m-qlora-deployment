// app/api/deepseek/route.ts
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export const runtime = "nodejs";

const HF_ENDPOINT =
  "https://aq0id722fm7bd5xm.us-east-1.aws.endpoints.huggingface.cloud";

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

  // Exact prefix match
  if (out.startsWith(prompt)) {
    out = out.slice(prompt.length);
  } else {
    // Tolerate minor whitespace/newlines differences by stripping common "prompt then newline" patterns
    const idx = out.indexOf(prompt);
    if (idx === 0) out = out.slice(prompt.length);
  }

  // Trim leading whitespace that often appears after stripping
  out = out.replace(/^\s+/, "");
  return out;
}

/**
 * Robustly extract the first top-level JSON object from a string.
 * This avoids brittle regex. It scans for balanced braces outside strings.
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
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    } else {
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;

      if (depth === 0) {
        return text.slice(start, i + 1);
      }
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

  const response = await fetch(HF_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        // Make generation deterministic + reduce prompt echo likelihood
        do_sample: false,
        temperature: 0.0,
        top_p: 1.0,

        max_new_tokens: 150,

        // Many TGI/HF text-gen stacks honor this; some ignore it.
        return_full_text: false,

        // Some stacks honor "repetition_penalty" and "stop"; harmless if ignored.
        repetition_penalty: 1.05,
      },
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "HF endpoint request failed", details: await response.text() },
      { status: 502 }
    );
  }

  const data = await response.json();

  // 1) Pull raw generation field (may include prompt echo depending on server)
  const raw = extractGeneratedText(data) || "";

  // 2) Strip echoed prompt if present
  let cleaned = stripEchoedPrompt(raw, prompt);

  // 3) If the model/server still returned extra text, extract the first JSON object
  //    (this often fixes cases where the model prefaces JSON with explanations)
  const jsonSlice = extractFirstJsonObject(cleaned);
  if (jsonSlice) cleaned = jsonSlice;

  // 4) Parse for jsonb storage; store null if invalid
  let outputJson: any = null;
  try {
    outputJson = JSON.parse(cleaned);
  } catch {
    // leave null
  }

  const modelLabel = "hf-inference-endpoint";

  try {
    await sql`
      insert into value_extractions (input_text, output_json, model)
      values (${text}, ${outputJson}, ${modelLabel})
    `;
  } catch (err: any) {
    // If DB insert fails, still return output so UI doesn't break.
    return NextResponse.json(
      {
        output: cleaned,
        db_error: "Failed to insert into database",
        details: String(err?.message ?? err),
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ output: cleaned });
}
