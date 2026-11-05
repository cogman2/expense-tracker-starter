import { useId, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TICKET_CATEGORY_LABELS, ticketIdParamSchema } from "core";
import { Skeleton } from "@/components/ui/skeleton";
import {
  apiErrorMessage,
  assignTicket,
  getAssignees,
  getTicket,
  isNotFound,
  type TicketDetail,
  type TicketMessage,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/**
 * What the list hands its subject links (client/src/TicketsPage.tsx): the list's
 * query string, so "Back to tickets" returns to the same page, sort and filter.
 */
export interface TicketLinkState {
  listSearch?: string;
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString();
const formatDateTime = (iso: string) => new Date(iso).toLocaleString();

function BackLink() {
  const state = useLocation().state as TicketLinkState | null;
  return (
    <Link
      to={`/tickets${state?.listSearch ?? ""}`}
      className="text-sm text-gray-500 hover:text-gray-900"
    >
      ← Back to tickets
    </Link>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function Message({ message }: { message: TicketMessage }) {
  return (
    <li className="rounded-md border border-gray-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}
        </span>
        <time dateTime={message.receivedAt} className="text-gray-500">
          {formatDateTime(message.receivedAt)}
        </time>
      </div>
      {/* Plain text only: the server never sends the HTML body, and
          whitespace-pre-wrap keeps the email's own line breaks. */}
      <p className="mt-3 text-sm break-words whitespace-pre-wrap">{message.bodyText}</p>
    </li>
  );
}

/** The select's value for "nobody"; user ids are never empty. */
const UNASSIGNED = "";

/**
 * Who works the ticket, changeable by any signed-in user. Saves on change; the
 * select is disabled until the server answers, and a refusal shows its message.
 * Without the staff list there is nothing to pick from, so it reads as text.
 */
function AssigneeDetail({ ticket }: { ticket: TicketDetail }) {
  const selectId = useId();
  const queryClient = useQueryClient();
  const assignees = useQuery({
    queryKey: queryKeys.tickets.assignees,
    queryFn: ({ signal }) => getAssignees(signal),
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => assignTicket(ticket.id, { assigneeId }),
    onSuccess: (assignee) => {
      queryClient.setQueryData<TicketDetail>(queryKeys.tickets.detail(ticket.id), (old) =>
        old ? { ...old, assignee } : old,
      );
      // The list shows assignees too, and sorts by them.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all });
    },
  });

  if (!assignees.data) {
    return <Detail label="Assignee">{ticket.assignee?.name ?? "Unassigned"}</Detail>;
  }
  // Keep the current assignee selectable even if the staff list predates them.
  const options =
    ticket.assignee && !assignees.data.some((a) => a.id === ticket.assignee!.id)
      ? [ticket.assignee, ...assignees.data]
      : assignees.data;

  return (
    <div>
      <dt className="text-gray-500">
        <label htmlFor={selectId}>Assignee</label>
      </dt>
      <dd className="mt-0.5">
        <select
          id={selectId}
          className="w-full max-w-48 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
          value={ticket.assignee?.id ?? UNASSIGNED}
          disabled={assign.isPending}
          onChange={(event) =>
            assign.mutate(event.target.value === UNASSIGNED ? null : event.target.value)
          }
        >
          <option value={UNASSIGNED}>Unassigned</option>
          {options.map((assignee) => (
            <option key={assignee.id} value={assignee.id}>
              {assignee.name}
            </option>
          ))}
        </select>
        {assign.isError && (
          <p role="alert" className="mt-1 text-red-600">
            {apiErrorMessage(assign.error, "Could not assign the ticket.")}
          </p>
        )}
      </dd>
    </div>
  );
}

function TicketView({ ticket }: { ticket: TicketDetail }) {
  return (
    <>
      <h1 className="text-2xl font-bold break-words">{ticket.subject}</h1>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Detail label="Ticket #">#{ticket.id}</Detail>
        <Detail label="Status">{ticket.status}</Detail>
        <Detail label="Category">
          {ticket.category ? TICKET_CATEGORY_LABELS[ticket.category] : "—"}
        </Detail>
        <Detail label="Customer">
          {ticket.customer.name ? (
            <>
              {ticket.customer.name}
              <span className="block text-gray-500">{ticket.customer.email}</span>
            </>
          ) : (
            ticket.customer.email
          )}
        </Detail>
        <AssigneeDetail ticket={ticket} />
        <Detail label="Created">{formatDate(ticket.createdAt)}</Detail>
      </dl>

      <h2 className="mt-8 text-lg font-semibold">Messages</h2>
      {ticket.messages.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No messages.</p>
      ) : (
        <ol className="mt-3 space-y-4">
          {ticket.messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
        </ol>
      )}
    </>
  );
}

function TicketSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-80 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-32" />
        ))}
      </div>
      <Skeleton className="mt-8 h-24 w-full" />
    </>
  );
}

const NotFound = () => <p className="text-sm text-gray-500">Ticket not found.</p>;

export function TicketDetailPage() {
  // A malformed id (/tickets/abc) can't name a ticket: say so without asking
  // the server, which would only answer 400. Same rule the server applies.
  const parsedId = ticketIdParamSchema.safeParse(useParams().id);
  const id = parsedId.success ? parsedId.data : null;

  const { data, error, isPending } = useQuery({
    queryKey: queryKeys.tickets.detail(id ?? 0),
    queryFn: ({ signal }) => getTicket(id!, signal),
    enabled: id !== null,
  });

  return (
    <main className="max-w-4xl p-8 font-sans text-gray-900">
      <BackLink />
      <section className="mt-4" aria-busy={id !== null && isPending}>
        {id === null || isNotFound(error) ? (
          <NotFound />
        ) : error ? (
          <p className="text-sm text-red-600">Could not load ticket.</p>
        ) : data ? (
          <TicketView ticket={data} />
        ) : (
          <TicketSkeleton />
        )}
      </section>
    </main>
  );
}
