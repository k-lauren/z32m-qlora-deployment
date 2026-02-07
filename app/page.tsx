"use client";

import { useState } from "react";

export default function Home() {
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOutput("");

    try {
      const res = await fetch("/api/deepseek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      setOutput(data?.output ?? "");
    } catch (err: any) {
      setError(err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "48px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
        Initial Model Draft
      </h1>

      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        Insert demo text below, and see it transformed into our strict JSON format. Outputs are connected to a database to which they are committed.
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter sample text…"
          rows={8}
          style={{
            width: "100%",
            padding: 12,
            fontSize: 14,
            borderRadius: 10,
            border: "1px solid #ddd",
            resize: "vertical",
          }}
        />

        <button
          type="submit"
          disabled={loading || text.trim().length === 0}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Calling DeepSeek…" : "Submit"}
        </button>
      </form>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #f2c2c2",
            background: "#fff5f5",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          Output
        </h2>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            padding: 12,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fafafa",
            minHeight: 80,
          }}
        >
          {output || "(No output yet)"}
        </pre>
      </div>
    </main>
  );
}
