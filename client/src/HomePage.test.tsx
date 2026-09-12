import { afterEach, describe, expect, mock, test } from "bun:test";
import { MemoryRouter } from "react-router";
import {
  authClientMock,
  renderComponent,
  setSession,
  unmountAll,
} from "./testUtils";
import { respondWith, restoreHttp } from "./testHttp";

mock.module("./auth-client", authClientMock);

const { HomePage } = await import("./HomePage");

// HomePage calls useNavigate (for sign-out), so it needs a router around it.
const render = () =>
  renderComponent(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

afterEach(async () => {
  await unmountAll();
  restoreHttp();
});

describe("HomePage server status", () => {
  test("renders the health payload when the request succeeds", async () => {
    setSession({ user: { role: "admin", name: "Admin" } });
    respondWith(200, {
      status: "ok",
      service: "helpdesk-server",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    const text = (await render()).textContent ?? "";

    expect(text).toContain("Server status:");
    expect(text).toContain("ok");
    expect(text).toContain("helpdesk-server");
    expect(text).toContain("2024-01-01T00:00:00.000Z");
    expect(text).not.toContain("Server error:");
  });

  test("renders an error instead of health data when the request fails", async () => {
    // The migration's behaviour change: under fetch this 500's JSON body was
    // rendered as if the server were healthy, because nothing checked res.ok.
    setSession({ user: { role: "admin", name: "Admin" } });
    respondWith(500, { status: "ok", service: "lying", timestamp: "" });

    const text = (await render()).textContent ?? "";

    expect(text).toContain("Server error:");
    expect(text).toContain("Request failed with status code 500");
    expect(text).not.toContain("Server status:");
    expect(text).not.toContain("lying");
  });
});
