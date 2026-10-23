import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  SORT_ORDERS,
  SortOrder,
  TICKET_CATEGORY_LABELS,
  TICKET_FILTER_KEYS,
  TICKET_FILTERS,
  TICKET_SORT_FIELDS,
  TicketSortField,
  type SortOrderValue,
  type TicketFilterValues,
  type TicketListQuery,
  type TicketSortFieldValue,
} from "core";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTickets, type TicketRow } from "@/lib/api";
import { TicketFilters, type TicketFilterChange } from "./TicketFilters";
import { queryKeys } from "@/lib/queryKeys";

const SKELETON_ROWS = 5;

// The table only renders and tracks which header is sorted; the server does the
// sorting itself (manualSorting below), since it is the only side that sees
// every page. `columnMeta` types the layout data each column carries.
const features = tableFeatures({
  rowSortingFeature,
  columnMeta: {} as { width: string; bar: string },
});

const column = createColumnHelper<typeof features, TicketRow>();

const formatCreated = (iso: string) => new Date(iso).toLocaleDateString();

/** A customer who never gave a name is shown by address. */
const customerLabel = (ticket: TicketRow) =>
  ticket.customer.name || ticket.customer.email;

// Column ids are the server's sort fields, so a header's sort state is exactly
// what goes in ?sort=. Fixed widths for the same reason as the users table
// (client/src/UsersPage.tsx): the skeleton and the loaded rows share one layout,
// so nothing jumps when the data lands. `bar` is the placeholder width.
// Numbers and dates sort descending on first click (newest / highest first);
// text sorts A→Z.
const COLUMNS = column.columns([
  column.accessor("id", {
    id: TicketSortField.id,
    header: "Ticket #",
    cell: (info) => `#${info.getValue()}`,
    sortDescFirst: true,
    meta: { width: "w-[9%]", bar: "w-10" },
  }),
  column.accessor("subject", {
    id: TicketSortField.subject,
    header: "Subject",
    sortDescFirst: false,
    meta: { width: "w-[30%]", bar: "w-48" },
  }),
  column.accessor(customerLabel, {
    id: TicketSortField.customer,
    header: "Customer",
    sortDescFirst: false,
    meta: { width: "w-[20%]", bar: "w-32" },
  }),
  column.accessor("status", {
    id: TicketSortField.status,
    header: "Status",
    sortDescFirst: false,
    meta: { width: "w-[10%]", bar: "w-14" },
  }),
  // Shown by its display label; uncategorized (null) reads as a dash.
  column.accessor("category", {
    id: TicketSortField.category,
    header: "Category",
    cell: (info) => {
      const category = info.getValue();
      return category ? TICKET_CATEGORY_LABELS[category] : "—";
    },
    sortDescFirst: false,
    meta: { width: "w-[17%]", bar: "w-24" },
  }),
  column.accessor("createdAt", {
    id: TicketSortField.createdAt,
    header: "Created",
    cell: (info) => formatCreated(info.getValue()),
    sortDescFirst: true,
    meta: { width: "w-[14%]", bar: "w-20" },
  }),
]);

const cellPadding = (index: number) =>
  index === COLUMNS.length - 1 ? "py-2 break-words" : "py-2 pr-4 break-words";

const DEFAULT_SORT = TicketSortField.createdAt;
const DEFAULT_ORDER = SortOrder.desc;

/** The page in the URL, or 1 when it is missing or not a whole number of 1 or more. */
function pageFrom(params: URLSearchParams): number {
  const page = Number(params.get("page"));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** The sort in the URL, or newest first when it is missing or unknown. */
function sortFrom(params: URLSearchParams): Pick<TicketListQuery, "sort" | "order"> {
  const sort = params.get("sort");
  const order = params.get("order");
  return {
    sort: TICKET_SORT_FIELDS.find((field) => field === sort) ?? DEFAULT_SORT,
    order: SORT_ORDERS.find((value) => value === order) ?? DEFAULT_ORDER,
  };
}

/**
 * The filters in the URL, one param per core TICKET_FILTERS entry. A missing or
 * unknown value is no filter ("All"), as an unknown sort is the default order.
 */
function filtersFrom(params: URLSearchParams): TicketFilterValues {
  const filters: Record<string, string> = {};
  for (const key of TICKET_FILTER_KEYS) {
    const raw = params.get(key);
    const value = TICKET_FILTERS[key].values.find((option) => option === raw);
    if (value) filters[key] = value;
  }
  // Each value was matched against its own key's values above.
  return filters as TicketFilterValues;
}

const hasFilters = (filters: TicketFilterValues) =>
  TICKET_FILTER_KEYS.some((key) => filters[key] !== undefined);

/**
 * The URL for a query. Defaults stay out of it, as `page=1` always has, so the
 * plain /tickets link is the newest-first first page of every ticket.
 */
function searchFor(query: TicketListQuery): Record<string, string> {
  const { page, sort, order } = query;
  const search: Record<string, string> = {};
  if (page !== 1) search.page = String(page);
  if (sort !== DEFAULT_SORT || order !== DEFAULT_ORDER) {
    search.sort = sort;
    search.order = order;
  }
  for (const key of TICKET_FILTER_KEYS) {
    const value = query[key];
    if (value !== undefined) search[key] = value;
  }
  return search;
}

const ariaSort = (sorted: false | SortOrderValue) =>
  sorted === SortOrder.asc ? "ascending" : sorted === SortOrder.desc ? "descending" : "none";

function SortIcon({ sorted }: { sorted: false | SortOrderValue }) {
  const Icon =
    sorted === SortOrder.asc ? ArrowUp : sorted === SortOrder.desc ? ArrowDown : ArrowUpDown;
  return (
    <Icon
      aria-hidden="true"
      className={`size-3.5 shrink-0 ${sorted ? "text-gray-900" : "text-gray-400"}`}
    />
  );
}

type TicketsTable = ReturnType<typeof useTicketsTable>;

function TicketsTableFrame({
  table,
  children,
}: {
  table: TicketsTable;
  children: ReactNode;
}) {
  return (
    <div className="max-w-4xl overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <colgroup>
          {table.getAllLeafColumns().map((col) => (
            <col key={col.id} className={col.columnDef.meta?.width} />
          ))}
        </colgroup>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-gray-200 text-gray-500">
              {group.headers.map((header, index) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    aria-sort={ariaSort(sorted)}
                    className={`${cellPadding(index)} font-medium`}
                  >
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 hover:text-gray-900"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <table.FlexRender header={header} />
                      <SortIcon sorted={sorted} />
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        {children}
      </table>
    </div>
  );
}

function TicketsTableSkeleton({ table }: { table: TicketsTable }) {
  return (
    <TicketsTableFrame table={table}>
      <tbody>
        {Array.from({ length: SKELETON_ROWS }, (_, row) => (
          <tr key={row} className="border-b border-gray-100">
            {table.getAllLeafColumns().map((col, index) => (
              <td key={col.id} className={cellPadding(index)}>
                <Skeleton className={`h-4 ${col.columnDef.meta?.bar}`} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TicketsTableFrame>
  );
}

/**
 * The table instance, its sort state owned by the URL: the table reads
 * `sorting` from `query` and reports header clicks to `onSort`. One column at a
 * time, toggling between directions — there is no unsorted state, since the
 * server always applies some order.
 */
function useTicketsTable(
  tickets: TicketRow[],
  { sort, order }: Pick<TicketListQuery, "sort" | "order">,
  onSort: (sort: TicketSortFieldValue, order: SortOrderValue) => void,
) {
  const sorting: SortingState = [{ id: sort, desc: order === SortOrder.desc }];
  return useTable({
    features,
    columns: COLUMNS,
    data: tickets,
    getRowId: (ticket) => String(ticket.id),
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const [next] = typeof updater === "function" ? updater(sorting) : updater;
      const field = TICKET_SORT_FIELDS.find((f) => f === next?.id);
      if (next && field) onSort(field, next.desc ? SortOrder.desc : SortOrder.asc);
    },
  });
}

export function TicketsPage() {
  // The page, sort and filters live in the URL, so a reload or Back keeps the
  // reader's place, order and selection.
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const filters = filtersFrom(searchParams);
  const query: TicketListQuery = { page, ...sortFrom(searchParams), ...filters };

  // keepPreviousData holds the current page on screen while the next one loads,
  // instead of dropping back to the skeleton on every click.
  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: queryKeys.tickets.list(query),
    queryFn: ({ signal }) => getTickets(query, signal),
    placeholderData: keepPreviousData,
  });

  const goTo = (next: number) => setSearchParams(searchFor({ ...query, page: next }));
  // A new order or filter starts over at the first page: page 3 of a different
  // order or selection is a different set of tickets. Each keeps the other.
  const sortBy = (sort: TicketSortFieldValue, order: SortOrderValue) =>
    setSearchParams(searchFor({ ...query, page: 1, sort, order }));
  const filterBy: TicketFilterChange = (key, value) =>
    setSearchParams(searchFor({ ...query, page: 1, [key]: value }));

  const tickets = data?.tickets ?? [];
  const table = useTicketsTable(tickets, query, sortBy);
  // Everything describing the list on screen comes from the response, not the
  // URL: while a new page, sort or filter loads, keepPreviousData keeps the
  // previous response on screen, and its page, total and filters are the ones
  // that match the rows shown. The URL's values only take over once they load.
  const shownPage = data?.page ?? page;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? first + tickets.length - 1 : 0;

  return (
    <main className="p-8 font-sans text-gray-900">
      <h1 className="text-2xl font-bold">Tickets</h1>

      {/* Outside the busy section so it stays usable whatever the list shows,
          including "no matches" and errors. */}
      <div className="mt-6 max-w-4xl">
        <TicketFilters values={filters} onChange={filterBy} />
      </div>

      <section className="mt-4" aria-busy={isPending || isPlaceholderData}>
        {isError && <p className="text-sm text-red-600">Could not load tickets.</p>}
        {!isError && isPending && <TicketsTableSkeleton table={table} />}
        {!isError && data && data.total === 0 && (
          <p className="text-sm text-gray-500">
            {hasFilters(data.filters) ? "No tickets match this filter." : "No tickets yet."}
          </p>
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
            <TicketsTableFrame table={table}>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100">
                    {row.getAllCells().map((cell, index) => (
                      <td key={cell.id} className={cellPadding(index)}>
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
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
                  disabled={shownPage <= 1 || isPlaceholderData}
                  onClick={() => goTo(shownPage - 1)}
                >
                  Previous
                </Button>
                <span className="text-gray-500">
                  Page {shownPage} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={shownPage >= totalPages || isPlaceholderData}
                  onClick={() => goTo(shownPage + 1)}
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
