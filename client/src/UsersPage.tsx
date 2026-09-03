import { useState } from "react";
import { useForm } from "react-hook-form";
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

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["admin", "agent"]),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

export function UsersPage() {
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);

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
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Same-origin request; the session cookie is sent automatically so the
      // server's requireAdmin guard can authorize it.
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError("root", {
        message: data?.error ?? "Could not create the user. Please try again.",
      });
      return;
    }

    setCreatedMessage(`Created ${values.role} account for ${values.email}.`);
    reset();
  });

  return (
    <main className="p-8 font-sans text-gray-900">
      <h1 className="text-2xl font-bold">Users</h1>

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
