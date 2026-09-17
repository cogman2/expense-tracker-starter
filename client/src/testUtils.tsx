// Shared helpers for the component specs. Named testUtils (not *.test.*) so
// `bun test` does not treat it as a suite.
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mounted: { container: HTMLDivElement; root: Root }[] = [];

type Session = { user: { role: "admin" | "agent"; name: string } } | null;

let session: Session = null;

/** Sets the session the mocked useSession reports. Call before rendering. */
export function setSession(next: Session): void {
  session = next;
}

// Every spec that mocks "./auth-client" must use this same factory. mock.module
// registrations are global to the `bun test` process, so two files registering
// the same specifier with different behaviour would fight; sharing one factory
// backed by module-level state means whichever registration wins behaves the
// same, and each test still drives it through setSession.
export const authClientMock = () => ({
  useSession: () => ({ data: session, isPending: false }),
  signIn: { email: async () => ({ error: null }) },
  signOut: async () => {},
  authClient: {},
});

// A throwaway client per render. Sharing one would leak cached rows between
// tests, and retries would make the failure specs slow and flaky — a spec that
// asserts an error state should not sit through three rounds of backoff first.
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// Lets pending promises settle and React apply the resulting updates. A query
// starts during render and resolves a microtask later, so rendering alone does
// not produce settled markup the way a plain useEffect + setState did.
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Mounts `ui` inside a fresh QueryClientProvider, waits for its queries to
// settle, and returns the container.
export async function renderComponent(ui: ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      <QueryClientProvider client={createTestQueryClient()}>
        {ui}
      </QueryClientProvider>,
    );
  });
  await flush();
  return container;
}

// Call from afterEach so a failed assertion never leaves a tree mounted for the
// next test.
export async function unmountAll(): Promise<void> {
  for (const { container, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
}

// react-hook-form's register() listens for React's synthetic change event, which
// rides on a native "input" event. Assigning el.value directly goes unnoticed by
// React (it tracks the last value it set), so the value has to go through the
// prototype setter first to defeat that tracking.
export function setInput(
  el: HTMLInputElement | HTMLSelectElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
