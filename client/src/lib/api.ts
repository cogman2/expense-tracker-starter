// The client's HTTP layer. Every call to our own Express API goes through here
// (Better Auth is the exception — it ships its own fetch layer, see auth-client).
import axios from "axios";

// No baseURL: paths are written out in full so the Vite dev proxy rules apply as
// written. The proxy treats them asymmetrically — `/api/users`, `/api/me` and
// `/api/auth` are forwarded untouched, while the generic `/api` rule strips the
// prefix (`/api/health` -> server `/health`) — so a baseURL of "/api" would
// quietly send /health somewhere else.
export const api = axios.create({
  headers: { "Content-Type": "application/json" },
  // Same-origin today, but makes the session cookie explicit: the server's
  // requireAdmin guard authorizes off it.
  withCredentials: true,
});

export interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "agent";
  createdAt: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: "admin" | "agent";
}

// Each helper takes an optional AbortSignal. TanStack Query hands one to every
// queryFn, so passing it through is what makes an in-flight read abort when the
// component unmounts or a newer request supersedes it.
export async function getHealth(signal?: AbortSignal): Promise<ApiHealth> {
  const { data } = await api.get<ApiHealth>("/api/health", { signal });
  return data;
}

export async function getUsers(signal?: AbortSignal): Promise<UserRow[]> {
  const { data } = await api.get<{ users: UserRow[] }>("/api/users", { signal });
  return data.users;
}

// The create response omits createdAt — only the list endpoint returns it.
export async function createUser(
  input: CreateUserInput,
  signal?: AbortSignal,
): Promise<Omit<UserRow, "createdAt">> {
  const { data } = await api.post<{ user: Omit<UserRow, "createdAt"> }>(
    "/api/users",
    input,
    { signal },
  );
  return data.user;
}

// Surfaces the server's `{ error }` message from a failed response, falling back
// to `fallback` for cancellations, network errors, or any response without one.
export function apiErrorMessage(err: unknown, fallback: string): string {
  // A cancellation is not a server error — it carries no message worth showing.
  if (axios.isCancel(err)) {
    return fallback;
  }
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    if (typeof data?.error === "string") {
      return data.error;
    }
  }
  return fallback;
}
