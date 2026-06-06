import { useEffect, useState } from "react";

interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

export function App() {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<ApiHealth>)
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Helpdesk</h1>
      <p>Full-stack project: Express + React + TypeScript on Bun.</p>
      {health && (
        <p>
          Server status: <strong>{health.status}</strong> ({health.service}) —{" "}
          {health.timestamp}
        </p>
      )}
      {error && <p style={{ color: "crimson" }}>Server error: {error}</p>}
    </main>
  );
}
