import { Navigate, Outlet } from "react-router";
import { useSession } from "./auth-client";

// Route guard: like RequireAuth, but additionally restricts access to admins.
// Unauthenticated users go to /login; authenticated non-admins go to /.
export function RequireAdmin() {
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

  if (session.user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
