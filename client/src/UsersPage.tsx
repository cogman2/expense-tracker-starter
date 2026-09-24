import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { apiErrorMessage, createUser, getUsers } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["admin", "agent"]),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

const SKELETON_ROWS = 3;

// One definition for both the skeleton and the real table. The widths are
// declared here and applied through a <colgroup> under `table-fixed`, rather
// than left to the browser to derive from cell content: an auto-layout table
// re-measures its columns whenever the content changes, which made every column
// boundary jump as the skeleton gave way to data (the Name column went 185px ->
// 115px) and made the loaded table reflow whenever a long name or email landed.
// `bar` is the placeholder width, sized so the skeleton reads as names, emails
// and roles rather than four identical strips.
const COLUMNS = [
  { label: "Name", width: "w-[30%]", bar: "w-28" },
  { label: "Email", width: "w-[38%]", bar: "w-40" },
  { label: "Role", width: "w-[14%]", bar: "w-16" },
  { label: "Created", width: "w-[18%]", bar: "w-20" },
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

export function UsersPage() {
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);
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
    mutationFn: (values: CreateUserValues) => createUser(values),
    // Refresh the list in place rather than refetching by hand. Invalidating
    // the broad `users.all` key also covers the filtered lists to come.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "", role: "agent" },
    mode: "onChange",
  });

  const onSubmit = handleSubmit(async (values) => {
    setCreatedMessage(null);
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

    setCreatedMessage(`Created ${values.role} account for ${values.email}.`);
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
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <td className={cellPadding(0)}>{u.name}</td>
                  <td className={cellPadding(1)}>{u.email}</td>
                  <td className={cellPadding(2)}>{u.role}</td>
                  <td className={cellPadding(3)}>
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
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
              {createdMessage && (
                <p className="text-sm text-green-600">{createdMessage}</p>
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
