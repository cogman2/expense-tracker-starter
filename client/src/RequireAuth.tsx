import { Navigate, Outlet } from "react-router";
import { useSession } from "./auth-client";

// Route guard: waits for the session to resolve, redirects unauthenticated
// users to /login, otherwise renders the nested route.
export function RequireAuth() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <main className="p-8 font-sans text-gray-900">
        <p>Loading…</p>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
