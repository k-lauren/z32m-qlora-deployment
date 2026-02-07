"use client";

import { useState } from "react";

export default function HomePage() {
  const [inputText, setInputText] = useState("");
  const [output, setOutput] = useState("(No output yet)");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!inputText.trim()) {
      setOutput("Please enter some text.");
      return;
    }

    setLoading(true);
    setOutput("Calling model…");

    try {
      const res = await fetch("/api/deepseek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });

      const data = await res.json().catch(async () => ({
        error: `Non-JSON response (status ${res.status})`,
        details: await res.text().catch(() => ""),
      }));

      if (!res.ok) {
        setOutput(`ERROR ${res.status}\n\n${JSON.stringify(data, null, 2)}`);
        return;
      }

      // Render output + DB status so you can see inserts happening
      const lines: string[] = [];
      if (typeof data?.output === "string") lines.push(data.output);
      else lines.push(JSON.stringify(data, null, 2));

      if (data?.db) lines.push(`\n\n[DB] inserted id=${data.db.id} at ${data.db.created_at}`);
      if (data?.db_error) lines.push(`\n\n[DB ERROR] ${data.db_error}`);
      if (data?.parse_error) lines.push(`\n\n[PARSE ERROR] ${data.parse_error}`);

      setOutput(lines.join(""));
    } catch (err: any) {
      setOutput(`Network error:\n${String(err?.message ?? err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: "0 20px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Initial Model Draft</h1>
      <p style={{ marginBottom: 20, color: "#555" }}>
        Insert demo text below, and see it transformed into our strict JSON format. Outputs are connected to a database.
      </p>

      <textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        rows={6}
        style={{
          width: "100%",
          padding: 12,
          fontSize: 16,
          borderRadius: 8,
          border: "1px solid #ccc",
          marginBottom: 16,
        }}
      />

      <button
        onClick={handleSubmit}
        disabled={loading}
        style={{
          width: "100%",
          padding: "12px 0",
          fontSize: 16,
          borderRadius: 8,
          border: "1px solid #ccc",
          backgroundColor: loading ? "#eee" : "#fff",
          cursor: loading ? "not-allowed" : "pointer",
          marginBottom: 24,
        }}
      >
        {loading ? "Calling DeepSeek…" : "Submit"}
      </button>

      <h2 style={{ fontSize: 20, marginBottom: 8 }}>Output</h2>
      <pre
        style={{
          minHeight: 120,
          padding: 16,
          borderRadius: 8,
          border: "1px solid #ddd",
          backgroundColor: "#fafafa",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {output}
      </pre>
    </main>
  );
}
