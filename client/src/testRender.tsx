// Testing Library render for specs whose component reads through React Query.
// Named testRender (not *.test.*) so `bun test` does not treat it as a suite.
import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { createTestQueryClient } from "./testUtils";

// Renders inside a throwaway QueryClientProvider. The client is built once per
// call rather than inside the wrapper, so a re-render does not hand the tree a
// brand new cache mid-test.
export function renderWithQuery(ui: ReactElement): RenderResult {
  const client = createTestQueryClient();
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
