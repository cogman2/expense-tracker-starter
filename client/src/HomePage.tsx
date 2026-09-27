import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { signOut, useSession } from "./auth-client";
import { getHealth } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function HomePage() {
  const { data: session } = useSession();
  const navigate = useNavigate();

  // The signal aborts this read if the page unmounts before it lands.
  const { data: health, error } = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getHealth(signal),
  });

  async function handleSignOut() {
    await signOut({
      fetchOptions: {
        onSuccess: () => navigate("/login"),
      },
    });
  }

  return (
    <div className="font-sans text-gray-900">
      <nav className="flex items-center justify-between border-b border-gray-200 px-8 py-4">
        <strong>Helpdesk</strong>
        <div className="flex items-center gap-4">
          <span>{session?.user.name}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="p-8">
        <h1 className="text-2xl font-bold">Helpdesk</h1>
        <p className="mt-2 text-gray-700">
          Full-stack project: Express + React + TypeScript on Bun.
        </p>
        {health && (
          <p className="mt-2 text-gray-700">
            Server status: <strong>{health.status}</strong> ({health.service}) —{" "}
            {health.timestamp}
          </p>
        )}
        {error && (
          <p className="mt-2 text-red-600">Server error: {String(error)}</p>
        )}
      </main>
    </div>
  );
}
