import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { AxiosError } from "axios";
import { renderComponent, setInput, unmountAll } from "./testUtils";
import {
  fakeHttp,
  httpCalls,
  restoreHttp,
  type FakeResponse,
} from "./testHttp";
import { UsersPage } from "./UsersPage";
import type { CreateUserInput, UserRow } from "./lib/api";

// Per-test responses for the two endpoints the page uses. The page runs against
// the real lib/api module — only the network underneath it is faked — so these
// specs cover getUsers/createUser/apiErrorMessage wiring as well as the markup.
let onGet: () => FakeResponse;
let onPost: () => FakeResponse;

const rows: UserRow[] = [
  {
    id: "u1",
    name: "Ada Admin",
    email: "ada@example.com",
    role: "admin",
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "u2",
    name: "Gene Agent",
    email: "gene@example.com",
    role: "agent",
    createdAt: "2024-02-02T00:00:00.000Z",
  },
];

const validInput: CreateUserInput = {
  name: "New Person",
  email: "new@example.com",
  password: "password123",
  role: "agent",
};

const postCalls = () => httpCalls().filter((c) => c.method === "post");
const getCalls = () => httpCalls().filter((c) => c.method === "get");

// Fills the create-user form from `input`. The fields are driven through
// setInput so react-hook-form's onChange validation actually sees the values.
function fillForm(container: HTMLElement, input: CreateUserInput) {
  const field = <T extends HTMLElement>(id: string) => {
    const el = container.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`missing form field #${id}`);
    return el;
  };
  setInput(field<HTMLInputElement>("name"), input.name);
  setInput(field<HTMLInputElement>("email"), input.email);
  setInput(field<HTMLInputElement>("password"), input.password);
  setInput(field<HTMLSelectElement>("role"), input.role);
}

async function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("missing form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  onGet = () => ({ status: 200, data: { users: [] } });
  onPost = () => ({ status: 201, data: { user: { id: "new", ...validInput } } });
  fakeHttp((config) => (config.method === "post" ? onPost() : onGet()));
});

afterEach(async () => {
  await unmountAll();
  restoreHttp();
});

describe("users list", () => {
  test("shows a loading message while the request is in flight", async () => {
    onGet = () => ({ status: 200, pending: true });

    const text = (await renderComponent(<UsersPage />)).textContent ?? "";

    expect(text).toContain("Loading users…");
    expect(text).not.toContain("No users yet.");
  });

  test("shows an empty state when there are no users", async () => {
    onGet = () => ({ status: 200, data: { users: [] } });

    const text = (await renderComponent(<UsersPage />)).textContent ?? "";

    expect(text).toContain("No users yet.");
    expect(text).not.toContain("Loading users…");
  });

  test("renders a row per user", async () => {
    onGet = () => ({ status: 200, data: { users: rows } });

    const container = await renderComponent(<UsersPage />);
    const text = container.textContent ?? "";

    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(text).toContain("Ada Admin");
    expect(text).toContain("ada@example.com");
    expect(text).toContain("admin");
    expect(text).toContain("Gene Agent");
    expect(text).toContain("gene@example.com");
  });

  test("shows an error message when the request is rejected", async () => {
    onGet = () => ({ status: 403, data: { error: "forbidden" } });

    const container = await renderComponent(<UsersPage />);

    expect(container.textContent ?? "").toContain("Could not load users.");
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("create user form", () => {
  test("submits the form values and refreshes the list", async () => {
    const container = await renderComponent(<UsersPage />);
    expect(getCalls()).toHaveLength(1);

    fillForm(container, validInput);
    onGet = () => ({ status: 200, data: { users: rows } });
    await submitForm(container);

    expect(postCalls()).toHaveLength(1);
    expect(JSON.parse(postCalls()[0]!.data as string)).toEqual(validInput);
    expect(container.textContent ?? "").toContain(
      `Created agent account for ${validInput.email}.`,
    );
    // The list reloads in place — no page refresh (UsersPage.tsx:96).
    expect(getCalls()).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  test("surfaces the server's error message when creation fails", async () => {
    const message = "a user with that email already exists";
    onPost = () => ({ status: 409, data: { error: message } });

    const container = await renderComponent(<UsersPage />);
    fillForm(container, validInput);
    await submitForm(container);

    // Goes through the real apiErrorMessage against a real AxiosError.
    expect(container.textContent ?? "").toContain(message);
    expect(container.textContent ?? "").not.toContain("Could not create");
    // A failed create must not claim success or reload the list.
    expect(container.textContent ?? "").not.toContain("Created agent account");
    expect(getCalls()).toHaveLength(1);
  });

  test("falls back to a generic message when the failure carries no error body", async () => {
    onPost = () => {
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK);
    };

    const container = await renderComponent(<UsersPage />);
    fillForm(container, validInput);
    await submitForm(container);

    expect(container.textContent ?? "").toContain(
      "Could not create the user. Please try again.",
    );
  });
});
