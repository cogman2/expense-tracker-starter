import { Navigate, Outlet } from "react-router";
import { useSession } from "./auth-client";

// Route guard: waits for the session to resolve, redirects unauthenticated
// users to /login, otherwise renders the nested route.
export function RequireAuth() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <p>Loading…</p>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
