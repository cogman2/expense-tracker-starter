import { afterEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

// Drives the mocked session that the route guards (RequireAuth / RequireAdmin)
// read via useSession. Mutated per test, then App is rendered fresh.
type Role = "admin" | "agent";
type SessionState = {
  data: { user: { role: Role; name: string } } | null;
  isPending: boolean;
};
let sessionState: SessionState = { data: null, isPending: false };

// Mock the auth client before App (and the guards) are imported. Guards import
// "./auth-client"; this test lives beside them so the specifier resolves the same.
mock.module("./auth-client", () => ({
  useSession: () => sessionState,
  signIn: { email: async () => ({ error: null }) },
  signOut: async () => {},
  authClient: {},
}));

const { App } = await import("./App");

let container: HTMLDivElement;
let root: Root;

async function renderAt(path: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // Async act flushes effects (react-router's <Navigate> redirects in an
  // effect) and the resulting re-render to the destination route.
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
  return container.textContent ?? "";
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("/users routing", () => {
  test("renders the Users page for an admin", async () => {
    sessionState = { data: { user: { role: "admin", name: "Admin" } }, isPending: false };
    const text = await renderAt("/users");
    expect(text).toContain("Users");
  });

  test("redirects an agent (non-admin) to the homepage", async () => {
    sessionState = { data: { user: { role: "agent", name: "Agent" } }, isPending: false };
    const text = await renderAt("/users");
    // HomePage renders the "Helpdesk" heading; the Users page heading is absent.
    expect(text).toContain("Helpdesk");
    expect(text).not.toContain("Users");
  });

  test("redirects a logged-out visitor to the login page", async () => {
    sessionState = { data: null, isPending: false };
    const text = await renderAt("/users");
    expect(text).toContain("Sign in");
  });
});
