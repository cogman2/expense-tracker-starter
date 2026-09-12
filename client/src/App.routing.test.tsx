import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { authClientMock, setSession } from "./testUtils";
import { fakeHttp, restoreHttp } from "./testHttp";

// Mock the auth client before App (and the guards) are imported. Guards import
// "./auth-client"; this test lives beside them so the specifier resolves the
// same. The factory is shared with the other specs — see testUtils — because
// mock.module registrations are global to the whole `bun test` process.
mock.module("./auth-client", authClientMock);

// Keep the pages off the network. Faked at the axios adapter rather than by
// mocking "@/lib/api", which would replace that module for every other spec in
// the process too.
beforeEach(() => {
  fakeHttp((config) =>
    config.url === "/api/health"
      ? {
          status: 200,
          data: { status: "ok", service: "test", timestamp: "" },
        }
      : { status: 200, data: { users: [] } },
  );
});

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
  restoreHttp();
});

describe("/users routing", () => {
  test("renders the Users page for an admin", async () => {
    setSession({ user: { role: "admin", name: "Admin" } });
    const text = await renderAt("/users");
    expect(text).toContain("Users");
  });

  test("redirects an agent (non-admin) to the homepage", async () => {
    setSession({ user: { role: "agent", name: "Agent" } });
    const text = await renderAt("/users");
    // HomePage renders the "Helpdesk" heading; the Users page heading is absent.
    expect(text).toContain("Helpdesk");
    expect(text).not.toContain("Users");
  });

  test("redirects a logged-out visitor to the login page", async () => {
    setSession(null);
    const text = await renderAt("/users");
    expect(text).toContain("Sign in");
  });
});
