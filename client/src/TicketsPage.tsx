import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTickets, type TicketRow } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

const SKELETON_ROWS = 5;

// Fixed column widths for the same reason as the users table
// (client/src/UsersPage.tsx): the skeleton and the loaded rows share one layout,
// so nothing jumps when the data lands. `bar` is the placeholder width.
const COLUMNS = [
  { label: "Ticket #", width: "w-[10%]", bar: "w-10" },
  { label: "Subject", width: "w-[38%]", bar: "w-48" },
  { label: "Customer", width: "w-[24%]", bar: "w-32" },
  { label: "Status", width: "w-[12%]", bar: "w-14" },
  { label: "Created", width: "w-[16%]", bar: "w-20" },
] as const;

const formatCreated = (iso: string) => new Date(iso).toLocaleDateString();

const cellPadding = (index: number) =>
  index === COLUMNS.length - 1 ? "py-2 break-words" : "py-2 pr-4 break-words";

/** The page in the URL, or 1 when it is missing or not a whole number of 1 or more. */
function pageFrom(params: URLSearchParams): number {
  const page = Number(params.get("page"));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** A customer who never gave a name is shown by address. */
const customerLabel = (ticket: TicketRow) =>
  ticket.customer.name || ticket.customer.email;

function TicketsTableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-4xl overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.label} className={column.width} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            {COLUMNS.map((column, index) => (
              <th key={column.label} className={`${cellPadding(index)} font-medium`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

function TicketsTableSkeleton() {
  return (
    <TicketsTableFrame>
      <tbody>
        {Array.from({ length: SKELETON_ROWS }, (_, row) => (
          <tr key={row} className="border-b border-gray-100">
            {COLUMNS.map((column, index) => (
              <td key={column.label} className={cellPadding(index)}>
                <Skeleton className={`h-4 ${column.bar}`} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TicketsTableFrame>
  );
}

export function TicketsPage() {
  // The page lives in the URL, so a reload or Back keeps the reader's place.
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);

  // keepPreviousData holds the current page on screen while the next one loads,
  // instead of dropping back to the skeleton on every click.
  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: queryKeys.tickets.list({ page }),
    queryFn: ({ signal }) => getTickets(page, signal),
    placeholderData: keepPreviousData,
  });

  const goTo = (next: number) =>
    setSearchParams(next === 1 ? {} : { page: String(next) });

  const tickets = data?.tickets ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? first + tickets.length - 1 : 0;

  return (
    <main className="p-8 font-sans text-gray-900">
      <h1 className="text-2xl font-bold">Tickets</h1>

      <section className="mt-6" aria-busy={isPending || isPlaceholderData}>
        {isError && <p className="text-sm text-red-600">Could not load tickets.</p>}
        {!isError && isPending && <TicketsTableSkeleton />}
        {!isError && data && data.total === 0 && (
          <p className="text-sm text-gray-500">No tickets yet.</p>
        )}
        {/* A bookmarked page that no longer exists, e.g. ?page=9 of 3. */}
        {!isError && data && data.total > 0 && tickets.length === 0 && (
          <p className="text-sm text-gray-500">
            No tickets on this page.{" "}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => goTo(1)}
            >
              Go to the first page
            </button>
          </p>
        )}
        {!isError && tickets.length > 0 && (
          <>
            <TicketsTableFrame>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="border-b border-gray-100">
                    <td className={cellPadding(0)}>#{ticket.id}</td>
                    <td className={cellPadding(1)}>{ticket.subject}</td>
                    <td className={cellPadding(2)}>{customerLabel(ticket)}</td>
                    <td className={cellPadding(3)}>{ticket.status}</td>
                    <td className={cellPadding(4)}>
                      {formatCreated(ticket.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TicketsTableFrame>

            <nav
              aria-label="Ticket pages"
              className="mt-4 flex max-w-4xl items-center justify-between text-sm"
            >
              <span className="text-gray-500">
                Showing {first}–{last} of {data!.total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => goTo(page - 1)}
                >
                  Previous
                </Button>
                <span className="text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || isPlaceholderData}
                  onClick={() => goTo(page + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          </>
        )}
      </section>
    </main>
  );
}
