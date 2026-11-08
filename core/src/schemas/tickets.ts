import { z } from "zod";
import {
  SORT_ORDERS,
  SortOrder,
  TICKET_CATEGORIES,
  TICKET_SORT_FIELDS,
  TICKET_STATUSES,
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
      // A blank or whitespace-only name is no name: it becomes undefined, so it
      // is stored as NULL. Kept as "", it would sort as a real (empty) name —
      // ahead of everyone under ?sort=customer — while the list shows the
      // customer's email, and it would dodge the "unnamed last" ordering.
      name: z
        .string({ error: "from.name must be a string" })
        .trim()
        .transform((name) => name || undefined)
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
export const TICKETS_PAGE_SIZE = 10;

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

const TICKET_ID_MESSAGE = "ticket id must be a whole number of 1 or more";

// Ticket ids are a Postgres INTEGER (Prisma Int), so a larger number cannot name
// a ticket — and handed to Prisma it would be a query error, not a 404.
const MAX_TICKET_ID = 2_147_483_647;

/**
 * The :id of /api/tickets/:id (and the client's /tickets/:id). Path params
 * arrive as strings; only plain decimal digits with no leading zero name a
 * ticket, so each ticket has one URL — Number() alone would also take "0x10",
 * "1e3", " 7" or "7.0". Anything else is a 400, not a 404.
 */
export const ticketIdParamSchema = z
  .string({ error: TICKET_ID_MESSAGE })
  .regex(/^[1-9]\d*$/, TICKET_ID_MESSAGE)
  .transform(Number)
  .pipe(z.number().max(MAX_TICKET_ID, TICKET_ID_MESSAGE));

export type TicketIdParam = z.infer<typeof ticketIdParamSchema>;

const ASSIGNEE_MESSAGE = "assigneeId must be a user id or null";
const STATUS_MESSAGE = `status must be one of: ${TICKET_STATUSES.join(", ")}`;
const CATEGORY_MESSAGE = `category must be one of: ${TICKET_CATEGORIES.join(", ")}, or null`;
const UPDATE_FIELDS = ["assigneeId", "status", "category"] as const;
const EMPTY_UPDATE_MESSAGE = `provide at least one of: ${UPDATE_FIELDS.join(", ")}`;

/**
 * The PATCH /api/tickets/:id payload: a partial update of who works the ticket,
 * its status and its category. A missing field means "no change"; `null`
 * unassigns (assigneeId) or uncategorizes (category) — status is never null. At
 * least one field must be present, so an empty body is an error, not a no-op.
 *
 * The server also checks an assigneeId names an active user; that needs the
 * database. Control characters are refused here: no user id has one, and
 * Postgres rejects a NUL byte in a query parameter with an error rather than a
 * miss. Field order is the precedence a multiply-invalid body gets.
 */
export const updateTicketSchema = z
  .object(
    {
      assigneeId: z
        .string({ error: ASSIGNEE_MESSAGE })
        .trim()
        .min(1, ASSIGNEE_MESSAGE)
        .regex(/^\P{Cc}+$/u, ASSIGNEE_MESSAGE)
        .nullable()
        .optional(),
      status: z.enum(TICKET_STATUSES, { error: STATUS_MESSAGE }).optional(),
      category: z.enum(TICKET_CATEGORIES, { error: CATEGORY_MESSAGE }).nullable().optional(),
    },
    // A body that is not an object at all (an array, a bare string) gets the
    // API's wording, not zod's.
    { error: EMPTY_UPDATE_MESSAGE },
  )
  // Unknown keys are stripped, so { foo: 1 } lands here too.
  .refine((body) => UPDATE_FIELDS.some((field) => body[field] !== undefined), {
    error: EMPTY_UPDATE_MESSAGE,
  });

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

/** The longest reply POST /api/tickets/:id/replies accepts, in characters. */
export const REPLY_MAX_LENGTH = 10_000;

const REPLY_REQUIRED_MESSAGE = "reply body is required";

/**
 * Characters that draw nothing on their own. trim() only removes whitespace, so
 * a body of nothing but these would pass as text yet show as a blank reply:
 * format characters (\p{Cf}: zero-width space and joiners, word joiner, soft
 * hyphen, direction marks, BOM), combining marks with no base letter
 * (\p{Mn}, \p{Me}), and the Hangul fillers and blank braille cell, which are
 * letters and symbols by category but render empty.
 */
const INVISIBLE = /[\s\p{Cf}\p{Mn}\p{Me}ᅟᅠㅤﾠ⠀]/gu;

/** Whether the text has at least one character that shows on screen. */
const hasVisibleText = (text: string) => text.replace(INVISIBLE, "").length > 0;

/**
 * The length in characters as a person counts them — Unicode code points, so an
 * emoji is one, not the two UTF-16 units String#length counts. Stated here
 * rather than left to zod's `max`, whose counting is an implementation detail.
 */
const characterCount = (text: string) => [...text].length;

/**
 * The POST /api/tickets/:id/replies payload: a staff answer, as plain text. The
 * body is trimmed, and one that shows nothing — empty, or only invisible
 * characters — is refused rather than stored. A NUL byte is refused too:
 * Postgres rejects it in a text column with an error, which would be a 500
 * instead of this 400. Line breaks and other whitespace inside the body are
 * kept — the thread shows them as written.
 */
export const createReplySchema = z.object(
  {
    body: z
      .string({ error: REPLY_REQUIRED_MESSAGE })
      .trim()
      .refine(hasVisibleText, { error: REPLY_REQUIRED_MESSAGE })
      .refine((body) => characterCount(body) <= REPLY_MAX_LENGTH, {
        error: `reply body must be ${REPLY_MAX_LENGTH} characters or fewer`,
      })
      .refine((body) => !body.includes("\u0000"), {
        error: "reply body cannot contain a NUL character",
      }),
  },
  // A body that is not an object at all gets the API's wording, not zod's.
  { error: REPLY_REQUIRED_MESSAGE },
);

export type CreateReplyInput = z.infer<typeof createReplySchema>;
