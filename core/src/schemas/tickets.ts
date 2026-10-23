import { z } from "zod";
import {
  SORT_ORDERS,
  SortOrder,
  TICKET_SORT_FIELDS,
  TicketSortField,
} from "../constants/tickets";
import {
  TICKET_FILTER_KEYS,
  TICKET_FILTERS,
  type TicketFilterKey,
} from "../filters/tickets";

/** The subject a ticket gets when the email arrives without one. */
export const NO_SUBJECT = "(no subject)";

// RFC 5322 writes Message-IDs as <id@host>. They are stored without the angle
// brackets, so `<a@b>` in an In-Reply-To matches the `a@b` saved earlier.
const stripBrackets = (value: string) => value.replace(/^<|>$/g, "");

const messageIdField = (message: string) =>
  z
    .string({ error: message })
    .trim()
    .transform(stripBrackets)
    .pipe(z.string().min(1, message));

// Trim and lowercase BEFORE the format check, exactly as createUserSchema does
// (core/src/users.ts): it is what lets a customer who writes from
// Jane@Example.com and later jane@example.com stay one customer.
const emailField = (message: string) =>
  z.string({ error: message }).trim().toLowerCase().pipe(z.email(message));

/**
 * The POST /api/webhooks/inbound-email payload: one email, already parsed out of
 * MIME by whatever delivers it. Provider-agnostic on purpose — a SendGrid or SES
 * adapter maps its own payload onto this shape.
 *
 * Messages are worded for the API, since the server returns them verbatim as
 * `{ error }`. As in users.ts, each required field states its message twice, so
 * a missing field reports the field rather than zod's type error. Field order is
 * the precedence a multiply-invalid body gets.
 */
export const inboundEmailSchema = z.object({
  messageId: messageIdField("messageId is required"),
  from: z.object(
    {
      email: emailField("a valid from.email is required"),
      name: z
        .string({ error: "from.name must be a string" })
        .trim()
        .optional(),
    },
    { error: "a valid from.email is required" },
  ),
  to: z
    .array(emailField("to must contain only valid email addresses"), {
      error: "to must be a list of email addresses",
    })
    .min(1, "to must contain at least one address"),
  // An empty or missing subject still makes a ticket; it just has no title.
  subject: z
    .string({ error: "subject must be a string" })
    .optional()
    .transform((subject) => subject?.trim() || NO_SUBJECT),
  text: z.string({ error: "text is required" }),
  html: z.string({ error: "html must be a string" }).optional(),
  inReplyTo: z
    .string({ error: "inReplyTo must be a string" })
    .trim()
    .transform(stripBrackets)
    .optional(),
  references: z
    .array(
      z
        .string({ error: "references must be a list of message ids" })
        .trim()
        .transform(stripBrackets),
      { error: "references must be a list of message ids" },
    )
    .default([]),
});

/** The parsed payload: bracket-free ids, lowercased addresses, a subject. */
export type InboundEmailInput = z.infer<typeof inboundEmailSchema>;

/** How many tickets one page of GET /api/tickets holds. */
export const TICKETS_PAGE_SIZE = 25;

// Far beyond any real ticket count, but it keeps the offset the server computes
// from (page - 1) * TICKETS_PAGE_SIZE a sane number.
const MAX_TICKETS_PAGE = 100_000;

const PAGE_MESSAGE = "page must be a whole number of 1 or more";

const SORT_MESSAGE = `sort must be one of: ${TICKET_SORT_FIELDS.join(", ")}`;
const ORDER_MESSAGE = `order must be ${SORT_ORDERS.join(" or ")}`;

/**
 * One optional query param per entry in TICKET_FILTERS (../filters/tickets.ts),
 * so a new filter is validated without touching this file. Missing means "all".
 */
function filterParam<K extends TicketFilterKey>(key: K) {
  const { values } = TICKET_FILTERS[key];
  return z
    .enum(values, { error: `${key} must be one of: ${values.join(", ")}` })
    .optional();
}

function filterParams() {
  const params = Object.fromEntries(
    TICKET_FILTER_KEYS.map((key) => [key, filterParam(key)]),
  );
  // Object.fromEntries types its result as a string-keyed record; restate the
  // exact per-key schemas, which is what each entry was built from.
  return params as unknown as {
    [K in TicketFilterKey]: ReturnType<typeof filterParam<K>>;
  };
}

/**
 * The GET /api/tickets query string. Query values arrive as strings, so `page`
 * is coerced; a missing one means the first page. A missing sort means newest
 * first — the list's order before sorting existed. Filters come last, so a
 * multiply-invalid query reports its page or sort first.
 */
export const ticketListQuerySchema = z.object({
  page: z.coerce
    .number({ error: PAGE_MESSAGE })
    .int(PAGE_MESSAGE)
    .min(1, PAGE_MESSAGE)
    .max(MAX_TICKETS_PAGE, "page is too large")
    .default(1),
  sort: z
    .enum(TICKET_SORT_FIELDS, { error: SORT_MESSAGE })
    .default(TicketSortField.createdAt),
  order: z.enum(SORT_ORDERS, { error: ORDER_MESSAGE }).default(SortOrder.desc),
  ...filterParams(),
});

export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;
