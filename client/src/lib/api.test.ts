import { afterEach, describe, expect, test } from "bun:test";
import axios, { AxiosError } from "axios";
import {
  fakeHttp,
  httpCalls,
  respondWith,
  restoreHttp,
} from "../testHttp";
import {
  apiErrorMessage,
  createUser,
  getHealth,
  getUsers,
  type UserRow,
} from "./api";

afterEach(restoreHttp);

const userRow: UserRow = {
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  role: "admin",
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("request shape", () => {
  test("getHealth issues GET /api/health", async () => {
    respondWith(200, {
      status: "ok",
      service: "helpdesk-server",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    await getHealth();

    expect(httpCalls()).toHaveLength(1);
    // No baseURL: the absolute path is what keeps the Vite proxy's prefix-strip
    // rule (/api/health -> server /health) pointing where the app expects.
    expect(httpCalls()[0]!.url).toBe("/api/health");
    expect(httpCalls()[0]!.method).toBe("get");
    expect(httpCalls()[0]!.withCredentials).toBe(true);
  });

  test("getUsers issues GET /api/users", async () => {
    respondWith(200, { users: [] });

    await getUsers();

    expect(httpCalls()[0]!.url).toBe("/api/users");
    expect(httpCalls()[0]!.method).toBe("get");
    expect(httpCalls()[0]!.withCredentials).toBe(true);
  });

  test("createUser POSTs the input as a JSON body", async () => {
    respondWith(201, { user: userRow });
    const input = {
      name: "Ada",
      email: "ada@example.com",
      password: "password123",
      role: "admin" as const,
    };

    await createUser(input);

    const call = httpCalls()[0]!;
    expect(call.url).toBe("/api/users");
    expect(call.method).toBe("post");
    expect(call.withCredentials).toBe(true);
    // transformRequest has already serialized the body by the time the adapter
    // runs, so compare the parsed string rather than the original object.
    expect(JSON.parse(call.data as string)).toEqual(input);
    expect(call.headers["Content-Type"]).toBe("application/json");
  });
});

describe("response unwrapping", () => {
  test("getHealth returns the health body", async () => {
    const body = {
      status: "ok" as const,
      service: "helpdesk-server",
      timestamp: "2024-01-01T00:00:00.000Z",
    };
    respondWith(200, body);

    expect(await getHealth()).toEqual(body);
  });

  test("getUsers returns the array, not the envelope", async () => {
    respondWith(200, { users: [userRow] });

    expect(await getUsers()).toEqual([userRow]);
  });

  test("createUser returns the user, not the envelope", async () => {
    const created = {
      id: "u2",
      name: "Grace",
      email: "grace@example.com",
      role: "agent" as const,
    };
    respondWith(201, { user: created });

    expect(await createUser({ ...created, password: "password123" })).toEqual(
      created,
    );
  });
});

describe("non-2xx responses reject", () => {
  // UsersPage.loadUsers dropped its manual res.ok check and relies on this.
  test.each([401, 403, 500])("getUsers rejects on %i", async (status) => {
    respondWith(status, { error: "nope" });

    await expect(getUsers()).rejects.toThrow();
  });

  test("createUser rejects on 409", async () => {
    respondWith(409, { error: "duplicate" });

    await expect(
      createUser({
        name: "Ada",
        email: "ada@example.com",
        password: "password123",
        role: "agent",
      }),
    ).rejects.toThrow();
  });
});

describe("cancellation", () => {
  test("passes the caller's signal through to axios", async () => {
    respondWith(200, { users: [] });
    const controller = new AbortController();

    await getUsers(controller.signal);

    // TanStack Query hands a signal to every queryFn; this is the wiring that
    // turns it into an actual abortable request.
    expect(httpCalls()[0]!.signal).toBe(controller.signal);
  });

  test("createUser accepts a signal too", async () => {
    respondWith(201, { user: { id: "u", name: "", email: "", role: "agent" } });
    const controller = new AbortController();

    await createUser(
      {
        name: "Ada",
        email: "ada@example.com",
        password: "password123",
        role: "agent",
      },
      controller.signal,
    );

    expect(httpCalls()[0]!.signal).toBe(controller.signal);
  });

  test("aborting before the response rejects with a cancellation", async () => {
    // Never settles on its own, so only the abort can end it.
    fakeHttp(() => new Promise<never>(() => {}));
    const controller = new AbortController();

    const pending = getUsers(controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
    await pending.catch((err: unknown) => {
      expect(axios.isCancel(err)).toBe(true);
    });
  });

  test("a cancelled request reports no error message", async () => {
    fakeHttp(() => new Promise<never>(() => {}));
    const controller = new AbortController();

    const pending = getUsers(controller.signal);
    controller.abort();

    const err = await pending.catch((e: unknown) => e);
    // UsersPage must not flash "Could not load users." for a read it abandoned.
    expect(apiErrorMessage(err, "fallback")).toBe("fallback");
  });
});

describe("apiErrorMessage", () => {
  // Produces a real rejection from the real request pipeline, rather than a
  // hand-built error object that might not match what axios actually throws.
  async function errorFrom(status: number, data: unknown): Promise<unknown> {
    respondWith(status, data);
    try {
      await getUsers();
      throw new Error("expected the request to reject");
    } catch (err) {
      return err;
    }
  }

  test("returns the server's error message", async () => {
    const err = await errorFrom(409, {
      error: "a user with that email already exists",
    });

    expect(apiErrorMessage(err, "fallback")).toBe(
      "a user with that email already exists",
    );
  });

  test("falls back when the response body has no error field", async () => {
    const err = await errorFrom(500, { message: "kaboom" });

    expect(apiErrorMessage(err, "fallback")).toBe("fallback");
  });

  test("falls back when the body is not an object", async () => {
    const err = await errorFrom(502, "<html>Bad Gateway</html>");

    expect(apiErrorMessage(err, "fallback")).toBe("fallback");
  });

  test("falls back for a network error with no response", async () => {
    fakeHttp(() => {
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK);
    });
    let caught: unknown;
    try {
      await getUsers();
    } catch (err) {
      caught = err;
    }

    expect((caught as AxiosError).response).toBeUndefined();
    expect(apiErrorMessage(caught, "fallback")).toBe("fallback");
  });

  test("falls back for a non-axios error", () => {
    expect(apiErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
