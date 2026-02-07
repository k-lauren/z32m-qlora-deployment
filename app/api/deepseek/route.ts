// app/api/deepseek/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const HF_ENDPOINT =
  "https://aq0id722fm7bd5xm.us-east-1.aws.endpoints.huggingface.cloud";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = body?.text;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Request body must include a 'text' string." },
        { status: 400 }
      );
    }

    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing HUGGINGFACE_API_KEY on server." },
        { status: 500 }
      );
    }

    const hfResponse = await fetch(HF_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: text,
        parameters: {
          temperature: 0,
          max_new_tokens: 800,
          return_full_text: false,
        },
      }),
    });

    if (!hfResponse.ok) {
      const errText = await hfResponse.text();
      return NextResponse.json(
        {
          error: "Hugging Face Inference Endpoint error",
          status: hfResponse.status,
          body: errText,
        },
        { status: hfResponse.status }
      );
    }

    const data = await hfResponse.json();

    /**
     * Common HF endpoint return shapes:
     * 1) [{ generated_text: "..." }]
     * 2) { generated_text: "..." }
     */
    const content =
      Array.isArray(data)
        ? data[0]?.generated_text
        : data?.generated_text;

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Inference endpoint returned no text content." },
        { status: 500 }
      );
    }

    return new NextResponse(content, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
