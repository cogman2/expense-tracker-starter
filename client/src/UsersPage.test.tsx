import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { AxiosError } from "axios";
import { renderWithQuery } from "./testRender";
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

// Skeletons are aria-hidden (components/ui/skeleton.tsx) so that they stay out
// of the accessibility tree — which also puts them out of reach of the role and
// text queries. Counting the data-slot is the one place these specs go around
// Testing Library rather than through it.
const skeletons = (container: HTMLElement) =>
  container.querySelectorAll('[data-slot="skeleton"]');

// Fills the create-user form the way a person would: typing into each field and
// picking the role, so react-hook-form's onChange validation runs for real.
async function fillForm(user: UserEvent, input: CreateUserInput) {
  await user.type(screen.getByLabelText("Name"), input.name);
  await user.type(screen.getByLabelText("Email"), input.email);
  await user.type(screen.getByLabelText("Password"), input.password);
  await user.selectOptions(screen.getByLabelText("Role"), input.role);
}

const submit = (user: UserEvent) =>
  user.click(screen.getByRole("button", { name: "Create user" }));

// The skeleton renders a table of its own, so findByRole("table") would resolve
// on it the instant the page mounts. Waiting for a real cell first is what tells
// the two apart.
async function findLoadedTable(): Promise<HTMLElement> {
  await screen.findByRole("cell", { name: rows[0]!.name });
  return screen.getByRole("table");
}

beforeEach(() => {
  onGet = () => ({ status: 200, data: { users: [] } });
  onPost = () => ({ status: 201, data: { user: { id: "new", ...validInput } } });
  fakeHttp((config) => (config.method === "post" ? onPost() : onGet()));
});

afterEach(() => {
  cleanup();
  restoreHttp();
});

describe("users list", () => {
  test("shows skeleton rows while the request is in flight", async () => {
    onGet = () => ({ status: 200, pending: true });

    const { container } = renderWithQuery(<UsersPage />);

    expect(skeletons(container).length).toBeGreaterThan(0);
    expect(container.querySelector("section")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText("No users yet.")).not.toBeInTheDocument();
  });

  test("shows an empty state when there are no users", async () => {
    onGet = () => ({ status: 200, data: { users: [] } });

    const { container } = renderWithQuery(<UsersPage />);

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
    // The skeleton must clear, not linger behind the settled content.
    expect(skeletons(container)).toHaveLength(0);
  });

  test("renders a row per user", async () => {
    onGet = () => ({ status: 200, data: { users: rows } });

    const { container } = renderWithQuery(<UsersPage />);
    const table = await findLoadedTable();

    expect(skeletons(container)).toHaveLength(0);
    // Header row plus one per user.
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    for (const row of rows) {
      expect(
        within(table).getByRole("cell", { name: row.name }),
      ).toBeInTheDocument();
      expect(
        within(table).getByRole("cell", { name: row.email }),
      ).toBeInTheDocument();
      expect(
        within(table).getByRole("cell", { name: row.role }),
      ).toBeInTheDocument();
    }
  });

  test("declares identical columns while loading and once loaded", async () => {
    onGet = () => ({ status: 200, pending: true });
    const loading = renderWithQuery(<UsersPage />).container;
    const loadingColumns = loading.querySelector("colgroup")?.outerHTML;
    cleanup();

    onGet = () => ({ status: 200, data: { users: rows } });
    const loaded = renderWithQuery(<UsersPage />).container;
    await findLoadedTable();
    const loadedColumns = loaded.querySelector("colgroup")?.outerHTML;

    // The two tables share one COLUMNS definition; if someone edits one and not
    // the other, the columns resize as the skeleton gives way to data.
    expect(loadingColumns).toBeDefined();
    expect(loadedColumns).toBe(loadingColumns!);
    // table-fixed is what makes the declared widths bind instead of the browser
    // re-measuring from cell content.
    expect(loaded.querySelector("table")).toHaveClass("table-fixed");
  });

  test("shows an error message when the request is rejected", async () => {
    onGet = () => ({ status: 403, data: { error: "forbidden" } });

    renderWithQuery(<UsersPage />);

    expect(await screen.findByText("Could not load users.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("create user form", () => {
  test("submits the form values and refreshes the list", async () => {
    const user = userEvent.setup();
    renderWithQuery(<UsersPage />);
    await screen.findByText("No users yet.");
    expect(getCalls()).toHaveLength(1);

    await fillForm(user, validInput);
    onGet = () => ({ status: 200, data: { users: rows } });
    await submit(user);

    expect(postCalls()).toHaveLength(1);
    expect(JSON.parse(postCalls()[0]!.data as string)).toEqual(validInput);
    expect(
      await screen.findByText(`Created agent account for ${validInput.email}.`),
    ).toBeInTheDocument();
    // The list reloads in place — no page refresh (UsersPage.tsx:120).
    expect(getCalls()).toHaveLength(2);
    const table = await findLoadedTable();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  test("disables the submit button while the creation is in flight", async () => {
    const user = userEvent.setup();
    onPost = () => ({ status: 201, pending: true });

    renderWithQuery(<UsersPage />);
    await screen.findByText("No users yet.");
    await fillForm(user, validInput);
    await submit(user);

    const button = await screen.findByRole("button", { name: "Creating…" });
    expect(button).toBeDisabled();
  });

  test("surfaces the server's error message when creation fails", async () => {
    const user = userEvent.setup();
    const message = "a user with that email already exists";
    onPost = () => ({ status: 409, data: { error: message } });

    renderWithQuery(<UsersPage />);
    await screen.findByText("No users yet.");
    await fillForm(user, validInput);
    await submit(user);

    // Goes through the real apiErrorMessage against a real AxiosError.
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/Could not create/)).not.toBeInTheDocument();
    // A failed create must not claim success or reload the list.
    expect(screen.queryByText(/Created agent account/)).not.toBeInTheDocument();
    expect(getCalls()).toHaveLength(1);
  });

  test("falls back to a generic message when the failure carries no error body", async () => {
    const user = userEvent.setup();
    onPost = () => {
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK);
    };

    renderWithQuery(<UsersPage />);
    await screen.findByText("No users yet.");
    await fillForm(user, validInput);
    await submit(user);

    expect(
      await screen.findByText("Could not create the user. Please try again."),
    ).toBeInTheDocument();
  });
});
