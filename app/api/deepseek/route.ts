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
  // Single-string prompt for HF text-generation style endpoints
  return `${SYSTEM_PROMPT}\n\nUser text: ${JSON.stringify(userText)}`;
}

function extractGeneratedText(data: any): string {
  // Common HF endpoint shapes:
  // 1) [{ generated_text: "..." }]
  // 2) { generated_text: "..." }
  // 3) { outputs: "..." } or { output: "..." } (some custom handlers)
  // 4) { choices: [{ text: "..." }] } (some OpenAI-compat layers)
  if (Array.isArray(data) && typeof data?.[0]?.generated_text === "string") {
    return data[0].generated_text;
  }
  if (typeof data?.generated_text === "string") return data.generated_text;
  if (typeof data?.outputs === "string") return data.outputs;
  if (typeof data?.output === "string") return data.output;
  if (typeof data?.choices?.[0]?.text === "string") return data.choices[0].text;

  // Last-resort: stringify so you can see what the endpoint actually returned
  return "";
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
        temperature: 0.0, // strict JSON friendliness
        max_new_tokens: 800,
        return_full_text: false, // try to return only completion (supported by many HF text-gen stacks)
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
  const output = extractGeneratedText(data) || "";

  // Parse JSON so to allow storage as jsonb; store null if invalid JSON.
  let outputJson: any = null;
  try {
    outputJson = JSON.parse(output);
  } catch {
    // leave null
  }

  // Store in Neon/Postgres: value_extractions(id, created_at, input_text, output_json, model)
  // NOTE: set model string to something that identifies the HF endpoint/model.
  const modelLabel = "hf-inference-endpoint";

  try {
    await sql`
      insert into value_extractions (input_text, output_json, model)
      values (${text}, ${outputJson}, ${modelLabel})
    `;
  } catch (err: any) {
    // If DB insert fails, return model output so UI doesn’t break.
    return NextResponse.json(
      {
        output,
        db_error: "Failed to insert into database",
        details: String(err?.message ?? err),
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ output });
}
