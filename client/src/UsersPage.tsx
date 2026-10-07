import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
// Shared with the server, which validates the same payload (core/src/users.ts).
import {
  createUserSchema,
  updateUserSchema,
  ROLES,
  type CreateUserInput,
  type UpdateUserInput,
} from "core";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  apiErrorMessage,
  createUser,
  getUsers,
  updateUser,
  type UserRow,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

const SKELETON_ROWS = 3;

// One definition for both the skeleton and the real table. The widths are
// declared here and applied through a <colgroup> under `table-fixed`, rather
// than left to the browser to derive from cell content: an auto-layout table
// re-measures its columns whenever the content changes, which made every column
// boundary jump as the skeleton gave way to data (the Name column went 185px ->
// 115px) and made the loaded table reflow whenever a long name or email landed.
// `bar` is the placeholder width, sized so the skeleton reads as names, emails
// and roles rather than four identical strips.
// `srOnlyLabel` marks a column whose header is for assistive tech only — the
// actions column shows icon buttons, so a visible "Actions" heading would be
// noise, but a blank <th> leaves the column unnamed.
const COLUMNS = [
  { label: "Name", width: "w-[28%]", bar: "w-28" },
  { label: "Email", width: "w-[34%]", bar: "w-40" },
  { label: "Role", width: "w-[14%]", bar: "w-16" },
  { label: "Created", width: "w-[14%]", bar: "w-20" },
  { label: "Actions", width: "w-[10%]", bar: "w-8", srOnlyLabel: true },
] as const;

const cellPadding = (index: number) =>
  index === COLUMNS.length - 1 ? "py-2" : "py-2 pr-4";

// The wrapper, column widths and header row, shared so the loading and loaded
// tables cannot drift apart. Callers supply only the <tbody>.
function UsersTableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-2xl overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.label} className={column.width} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            {COLUMNS.map((column, index) => (
              <th
                key={column.label}
                className={`${cellPadding(index)} font-medium`}
              >
                {"srOnlyLabel" in column ? (
                  <span className="sr-only">{column.label}</span>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

function UsersTableSkeleton() {
  return (
    <UsersTableFrame>
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
    </UsersTableFrame>
  );
}

// The row editor's role picker, styled like the create form's select but sized
// for a fixed-width table cell (full width, tighter padding).
const ROW_SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// One row in edit mode. It owns its own useForm against the shared update schema
// (the same wiring as the create form, per CLAUDE.md), so opening a row never
// disturbs the create form's state and the two sets of field errors stay apart.
//
// Rendered with key={user.id} by the caller, which is what guarantees fresh
// defaultValues when a different row is opened.
function UserRowEditor({
  user,
  onCancel,
  onSave,
}: {
  user: UserRow;
  onCancel: () => void;
  onSave: (values: UpdateUserInput) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { name: user.name, email: user.email, role: user.role },
    mode: "onChange",
  });

  // Not wrapped in a <form>: a <form> cannot contain a <tr>, and the cross-table
  // `form=` attribute dance buys nothing here. handleSubmit works as a plain
  // handler, called from the Save button and from Enter in any field.
  const submit = handleSubmit(async (values) => {
    try {
      await onSave(values);
    } catch (err) {
      setError("root", {
        message: apiErrorMessage(
          err,
          "Could not save the changes. Please try again.",
        ),
      });
    }
  });

  // Enter saves, Escape cancels — what a keyboard user expects of a row that has
  // turned into a form.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <>
      <tr className="border-b border-gray-100">
        <td className={cellPadding(0)}>
          {/* aria-label rather than a visible label: a table row has no room for
              one, but the field still needs a name — and it has to say *which*
              user's name, or it is indistinguishable from the create form's
              "Name" field to anyone navigating by label. `user` is the row as
              last fetched, so the label does not shift as the field is typed in. */}
          <Input
            aria-label={`Name for ${user.name}`}
            autoFocus
            aria-invalid={errors.name ? true : undefined}
            onKeyDown={onKeyDown}
            {...register("name")}
          />
        </td>
        <td className={cellPadding(1)}>
          <Input
            aria-label={`Email for ${user.name}`}
            type="email"
            aria-invalid={errors.email ? true : undefined}
            onKeyDown={onKeyDown}
            {...register("email")}
          />
        </td>
        <td className={cellPadding(2)}>
          <select
            aria-label={`Role for ${user.name}`}
            className={ROW_SELECT_CLASS}
            aria-invalid={errors.role ? true : undefined}
            onKeyDown={onKeyDown}
            {...register("role")}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </td>
        <td className={cellPadding(3)}>
          {new Date(user.createdAt).toLocaleDateString()}
        </td>
        <td className={cellPadding(4)}>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Save ${user.name}`}
              disabled={isSubmitting}
              onClick={() => void submit()}
            >
              <Check />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Cancel editing ${user.name}`}
              onClick={onCancel}
            >
              <X />
            </Button>
          </div>
        </td>
      </tr>
      {/* Errors live in their own full-width row: the server's messages are long
          enough to stretch a fixed-width cell out of shape. */}
      {(errors.root || errors.name || errors.email || errors.role) && (
        <tr className="border-b border-gray-100">
          <td colSpan={COLUMNS.length} className="pb-2 text-sm text-red-600">
            {errors.root?.message ??
              errors.name?.message ??
              errors.email?.message ??
              errors.role?.message}
          </td>
        </tr>
      )}
    </>
  );
}

export function UsersPage() {
  // Carries both outcomes now — a creation and a saved edit.
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Which row is open for editing; null means none. One at a time, so a
  // half-finished edit cannot be forgotten behind another.
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // The signal aborts the read if the page unmounts mid-load, so navigating
  // away cannot leave a late response to settle into a dead component.
  const {
    data: users,
    isPending,
    isError,
  } = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: ({ signal }) => getUsers(signal),
  });

  const createUserMutation = useMutation({
    mutationFn: (values: CreateUserInput) => createUser(values),
    // Refresh the list in place rather than refetching by hand. Invalidating
    // the broad `users.all` key also covers the filtered lists to come.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UpdateUserInput }) =>
      updateUser(id, values),
    // Same invalidation as creation: the PATCH response omits createdAt, so the
    // list is refetched rather than patched row by row.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
  });

  // Throws on failure so the row editor can surface the server's message inline
  // and stay open; the row closes only once the save lands.
  async function saveUser(user: UserRow, values: UpdateUserInput) {
    setStatusMessage(null);
    await updateUserMutation.mutateAsync({ id: user.id, values });
    setEditingId(null);
    setStatusMessage(`Saved changes to ${values.email}.`);
  }

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "", role: "agent" },
    mode: "onChange",
  });

  const onSubmit = handleSubmit(async (values) => {
    setStatusMessage(null);
    try {
      await createUserMutation.mutateAsync(values);
    } catch (err) {
      setError("root", {
        message: apiErrorMessage(
          err,
          "Could not create the user. Please try again.",
        ),
      });
      return;
    }

    setStatusMessage(`Created ${values.role} account for ${values.email}.`);
    reset();
  });

  return (
    <main className="p-8 font-sans text-gray-900">
      <h1 className="text-2xl font-bold">Users</h1>

      <section className="mt-6" aria-busy={isPending}>
        {isError && (
          <p className="text-sm text-red-600">Could not load users.</p>
        )}
        {!isError && isPending && <UsersTableSkeleton />}
        {!isError && users && users.length === 0 && (
          <p className="text-sm text-gray-500">No users yet.</p>
        )}
        {!isError && users && users.length > 0 && (
          <UsersTableFrame>
            <tbody>
              {users.map((u) =>
                editingId === u.id ? (
                  <UserRowEditor
                    key={u.id}
                    user={u}
                    onCancel={() => setEditingId(null)}
                    onSave={(values) => saveUser(u, values)}
                  />
                ) : (
                  <tr key={u.id} className="border-b border-gray-100">
                    <td className={cellPadding(0)}>{u.name}</td>
                    <td className={cellPadding(1)}>{u.email}</td>
                    <td className={cellPadding(2)}>{u.role}</td>
                    <td className={cellPadding(3)}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className={cellPadding(4)}>
                      {/* Per-row accessible name: "Edit" alone would give every
                          row's button the same name. */}
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${u.name}`}
                        onClick={() => {
                          setStatusMessage(null);
                          setEditingId(u.id);
                        }}
                      >
                        <Pencil />
                      </Button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </UsersTableFrame>
        )}
      </section>

      <Card className="mt-6 w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create user</CardTitle>
          <CardDescription>
            Provision a new staff account. The user can sign in immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <Field data-invalid={errors.name ? true : undefined}>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  autoComplete="off"
                  aria-invalid={errors.name ? true : undefined}
                  {...register("name")}
                />
                <FieldError errors={errors.name ? [errors.name] : undefined} />
              </Field>

              <Field data-invalid={errors.email ? true : undefined}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="off"
                  aria-invalid={errors.email ? true : undefined}
                  {...register("email")}
                />
                <FieldError errors={errors.email ? [errors.email] : undefined} />
              </Field>

              <Field data-invalid={errors.password ? true : undefined}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={errors.password ? true : undefined}
                  {...register("password")}
                />
                <FieldError
                  errors={errors.password ? [errors.password] : undefined}
                />
              </Field>

              <Field data-invalid={errors.role ? true : undefined}>
                <FieldLabel htmlFor="role">Role</FieldLabel>
                <select
                  id="role"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-invalid={errors.role ? true : undefined}
                  {...register("role")}
                >
                  <option value="agent">Agent</option>
                  <option value="admin">Admin</option>
                </select>
                <FieldError errors={errors.role ? [errors.role] : undefined} />
              </Field>

              {errors.root && <FieldError errors={[errors.root]} />}
              {statusMessage && (
                <p className="text-sm text-green-600">{statusMessage}</p>
              )}

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Creating…" : "Create user"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
