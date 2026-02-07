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
    setOutput("Calling DeepSeek…");

    let res: Response;
    try {
      res = await fetch("/api/deepseek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });
    } catch (err: any) {
      setOutput(`Network error:\n${String(err?.message ?? err)}`);
      setLoading(false);
      return;
    }

    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      setOutput(`Failed to read response (status ${res.status})`);
      setLoading(false);
      return;
    }

    if (!res.ok) {
      setOutput(`ERROR ${res.status}\n\n${bodyText}`);
      setLoading(false);
      return;
    }

    // Try to unwrap JSON; otherwise show raw text
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.output === "string") {
        setOutput(parsed.output);
      } else {
        setOutput(JSON.stringify(parsed, null, 2));
      }
    } catch {
      setOutput(bodyText || "(Empty response)");
    }

    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: "0 20px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Initial Model Draft</h1>
      <p style={{ marginBottom: 20, color: "#555" }}>
        Insert demo text below, and see it transformed into our strict JSON
        format. Outputs are connected to a database to which they are committed.
      </p>

      <textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        rows={6}
        placeholder="Enter text here…"
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
