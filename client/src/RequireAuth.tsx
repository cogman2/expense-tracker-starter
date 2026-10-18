import { Navigate, Outlet } from "react-router";
import { useSession } from "./auth-client";
import { PageSkeleton } from "@/components/PageSkeleton";

// Route guard: waits for the session to resolve, redirects unauthenticated
// users to /login, otherwise renders the nested route.
export function RequireAuth() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <PageSkeleton />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
