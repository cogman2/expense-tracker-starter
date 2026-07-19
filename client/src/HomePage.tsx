import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { signOut, useSession } from "./auth-client";

interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

export function HomePage() {
  const { data: session } = useSession();
  const navigate = useNavigate();

  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<ApiHealth>)
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  async function handleSignOut() {
    await signOut({
      fetchOptions: {
        onSuccess: () => navigate("/login"),
      },
    });
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 2rem",
          borderBottom: "1px solid #e2e2e2",
        }}
      >
        <strong>Helpdesk</strong>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span>{session?.user.name}</span>
          <button
            type="button"
            onClick={handleSignOut}
            style={{ padding: "0.4rem 0.8rem", cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <main style={{ padding: "2rem" }}>
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
    </div>
  );
}
