import { useId, useRef, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  createReplySchema,
  ticketIdParamSchema,
  type CreateReplyInput,
  type TicketCategoryValue,
  type TicketStatusValue,
  type UpdateTicketInput,
} from "core";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  apiErrorMessage,
  createReply,
  getAssignees,
  getTicket,
  isNotFound,
  type TicketDetail,
  type TicketMessage,
  type TicketReply,
  updateTicket,
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

function Reply({ reply }: { reply: TicketReply }) {
  return (
    <li className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{reply.author.name}</span>
        <time dateTime={reply.createdAt} className="text-gray-500">
          {formatDateTime(reply.createdAt)}
        </time>
      </div>
      <p className="mt-3 text-sm break-words whitespace-pre-wrap">{reply.body}</p>
    </li>
  );
}

/**
 * Posts a reply as the signed-in user. The saved reply is appended to the
 * cached ticket at once, then the ticket refetches so the thread also picks up
 * anyone else's replies. A refused or failed post keeps the typed text.
 *
 * The textarea has no maxLength on purpose: the browser would silently cut a
 * long paste short (and counts an emoji as two), so the schema's length message
 * says what is wrong instead.
 */
function ReplyForm({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const textareaId = useId();
  const errorId = useId();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateReplyInput>({
    resolver: zodResolver(createReplySchema),
    defaultValues: { body: "" },
  });
  // isSubmitting disables the button only once React re-renders; two submits in
  // the same tick would both get past it and post the reply twice. A ref is set
  // synchronously, so the second one stops here.
  const sending = useRef(false);

  const onSubmit = handleSubmit(async (values) => {
    if (sending.current) return;
    sending.current = true;
    let reply: TicketReply;
    try {
      reply = await createReply(ticketId, values);
    } catch (err) {
      setError("root", { message: apiErrorMessage(err, "Could not send the reply.") });
      return;
    } finally {
      sending.current = false;
    }
    queryClient.setQueryData<TicketDetail>(queryKeys.tickets.detail(ticketId), (old) =>
      old && !old.replies.some((r) => r.id === reply.id)
        ? { ...old, replies: [...old.replies, reply] }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.tickets.detail(ticketId) });
    reset();
  });

  const error = errors.body?.message ?? errors.root?.message;
  return (
    <form className="mt-4" onSubmit={onSubmit} noValidate>
      <label htmlFor={textareaId} className="text-sm font-medium">
        Reply
      </label>
      <textarea
        id={textareaId}
        rows={5}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm read-only:opacity-60"
        readOnly={isSubmitting}
        {...register("body")}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-2" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}

/**
 * Saves a change to one of the ticket's editable fields. Each picker calls this
 * for itself, so pending and error state stay per field. Only the fields this
 * save sent are merged into the cached ticket: the answer's other fields are a
 * snapshot from when it committed, and a slow answer would otherwise overwrite
 * a newer save from another picker. The list shows (and sorts and filters by)
 * these fields too, so every ["tickets", …] query refetches.
 */
function useTicketUpdate(ticketId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTicketInput) => updateTicket(ticketId, input),
    onSuccess: (saved, input) => {
      const changes: Partial<TicketDetail> = {
        ...(input.assigneeId !== undefined && { assignee: saved.assignee }),
        ...(input.status !== undefined && { status: saved.status }),
        ...(input.category !== undefined && { category: saved.category }),
      };
      queryClient.setQueryData<TicketDetail>(queryKeys.tickets.detail(ticketId), (old) =>
        old ? { ...old, ...changes } : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all });
    },
  });
}

/** The select's value for "none" (no assignee, no category); real values are never empty. */
const NONE = "";

/**
 * A ticket field that saves on change: a labelled select, disabled until the
 * server answers, and the refusal's message (or `fallback`) when it fails.
 */
function PickerDetail({
  label,
  value,
  options,
  update,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  update: ReturnType<typeof useTicketUpdate>;
  onChange: (value: string) => void;
  fallback: string;
}) {
  const selectId = useId();
  return (
    <div>
      <dt className="text-gray-500">
        <label htmlFor={selectId}>{label}</label>
      </dt>
      <dd className="mt-0.5">
        <select
          id={selectId}
          className="w-full max-w-48 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
          value={value}
          disabled={update.isPending}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {update.isError && (
          <p role="alert" className="mt-1 text-red-600">
            {apiErrorMessage(update.error, fallback)}
          </p>
        )}
      </dd>
    </div>
  );
}

const STATUS_OPTIONS = TICKET_STATUSES.map((status) => ({
  value: status,
  label: TICKET_STATUS_LABELS[status],
}));

/** Where the ticket stands, changeable by any signed-in user. */
function StatusDetail({ ticket }: { ticket: TicketDetail }) {
  const update = useTicketUpdate(ticket.id);
  return (
    <PickerDetail
      label="Status"
      value={ticket.status}
      options={STATUS_OPTIONS}
      update={update}
      // Only the listed statuses can be picked.
      onChange={(value) => update.mutate({ status: value as TicketStatusValue })}
      fallback="Could not update the status."
    />
  );
}

const CATEGORY_OPTIONS = [
  { value: NONE, label: "—" },
  ...TICKET_CATEGORIES.map((category) => ({
    value: category,
    label: TICKET_CATEGORY_LABELS[category],
  })),
];

/** What the ticket is about; "—" (null) until someone categorizes it, and can go back to it. */
function CategoryDetail({ ticket }: { ticket: TicketDetail }) {
  const update = useTicketUpdate(ticket.id);
  return (
    <PickerDetail
      label="Category"
      value={ticket.category ?? NONE}
      options={CATEGORY_OPTIONS}
      update={update}
      onChange={(value) =>
        update.mutate({ category: value === NONE ? null : (value as TicketCategoryValue) })
      }
      fallback="Could not update the category."
    />
  );
}

/**
 * Who works the ticket, changeable by any signed-in user. Without the staff
 * list there is nothing to pick from, so it reads as text.
 */
function AssigneeDetail({ ticket }: { ticket: TicketDetail }) {
  const update = useTicketUpdate(ticket.id);
  const assignees = useQuery({
    queryKey: queryKeys.tickets.assignees,
    queryFn: ({ signal }) => getAssignees(signal),
  });

  if (!assignees.data) {
    return <Detail label="Assignee">{ticket.assignee?.name ?? "Unassigned"}</Detail>;
  }
  // Keep the current assignee selectable even if the staff list predates them.
  const staff =
    ticket.assignee && !assignees.data.some((a) => a.id === ticket.assignee!.id)
      ? [ticket.assignee, ...assignees.data]
      : assignees.data;

  return (
    <PickerDetail
      label="Assignee"
      value={ticket.assignee?.id ?? NONE}
      options={[
        { value: NONE, label: "Unassigned" },
        ...staff.map((assignee) => ({ value: assignee.id, label: assignee.name })),
      ]}
      update={update}
      onChange={(value) => update.mutate({ assigneeId: value === NONE ? null : value })}
      fallback="Could not assign the ticket."
    />
  );
}

function TicketView({ ticket }: { ticket: TicketDetail }) {
  const messagesHeadingId = useId();
  const repliesHeadingId = useId();
  return (
    <>
      <h1 className="text-2xl font-bold break-words">{ticket.subject}</h1>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Detail label="Ticket #">#{ticket.id}</Detail>
        <StatusDetail ticket={ticket} />
        <CategoryDetail ticket={ticket} />
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

      <h2 id={messagesHeadingId} className="mt-8 text-lg font-semibold">
        Messages
      </h2>
      {ticket.messages.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No messages.</p>
      ) : (
        <ol aria-labelledby={messagesHeadingId} className="mt-3 space-y-4">
          {ticket.messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
        </ol>
      )}

      <h2 id={repliesHeadingId} className="mt-8 text-lg font-semibold">
        Replies
      </h2>
      {ticket.replies.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No replies yet.</p>
      ) : (
        <ol aria-labelledby={repliesHeadingId} className="mt-3 space-y-4">
          {ticket.replies.map((reply) => (
            <Reply key={reply.id} reply={reply} />
          ))}
        </ol>
      )}
      <ReplyForm ticketId={ticket.id} />
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
        {/* A failed background refetch (each save triggers one) keeps showing
            the ticket already loaded; only a 404 means it is gone. */}
        {id === null || isNotFound(error) ? (
          <NotFound />
        ) : data ? (
          <TicketView ticket={data} />
        ) : error ? (
          <p className="text-sm text-red-600">Could not load ticket.</p>
        ) : (
          <TicketSkeleton />
        )}
      </section>
    </main>
  );
}
