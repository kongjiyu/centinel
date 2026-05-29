import { useState, useCallback } from "react";
import "./App.css";

type CheckResult = {
  status: string;
  message?: string;
  screenshotPath?: string;
  raw?: string;
};

type SmokeResults = {
  sqlite: string;
  minimax: string;
  playwright: string;
  gemini: string;
  artifacts: Record<string, string>;
};

function StatusCard({ name, status }: { name: string; status: string }) {
  const isPass = status === "pass";
  const isPending = status === "pending";
  const isFail = status === "fail";

  return (
    <div className={`status-card ${isPass ? "pass" : isFail ? "fail" : "pending"}`}>
      <span className="status-dot" />
      <span className="status-label">{name}</span>
      <span className="status-value">
        {isPending ? "pending" : isPass ? "pass" : "fail"}
      </span>
    </div>
  );
}

function App() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SmokeResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSmoke = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:37701/smoke", {
        method: "POST",
      });
      const text = await res.text();
      setResults(JSON.parse(text));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="container">
      <h1 className="title">Centinel</h1>
      <p className="subtitle">Phase 0 — Stack Validation</p>

      <div className="cards-grid">
        <StatusCard name="Desktop Shell (Tauri)" status={results?.sqlite ? "pass" : "pending"} />
        <StatusCard name="SQLite" status={results?.sqlite ?? "pending"} />
        <StatusCard name="MiniMax" status={results?.minimax ?? "pending"} />
        <StatusCard name="Playwright" status={results?.playwright ?? "pending"} />
        <StatusCard name="Gemini" status={results?.gemini ?? "pending"} />
      </div>

      <div className="actions">
        <button onClick={runSmoke} disabled={running} className="btn-primary">
          {running ? "Running..." : "Run Phase 0 Smoke Check"}
        </button>
      </div>

      {error && (
        <div className="error-panel">
          <strong>Error:</strong> {error}
        </div>
      )}

      {results && (
        <div className="result-panel">
          <h3>Results</h3>
          <pre>{JSON.stringify(results, null, 2)}</pre>
          {results.artifacts?.screenshot && (
            <div className="screenshot-preview">
              <img src={`file://${results.artifacts.screenshot}`} alt="screenshot" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
