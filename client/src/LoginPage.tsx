import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useNavigate } from "react-router";
import { signIn, useSession } from "./auth-client";

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

const inputClass =
  "rounded border px-2 py-2 text-base outline-none focus:border-gray-500";
const errorClass = "m-0 text-sm text-red-600";

export function LoginPage() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onChange",
  });

  // Already signed in: no reason to show the form.
  if (!isPending && session) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = handleSubmit(async ({ email, password }) => {
    const { error } = await signIn.email({ email, password });
    if (error) {
      // Surface server errors (e.g. bad credentials) at the form level.
      setError("root", {
        message: error.message ?? "Sign in failed. Check your credentials.",
      });
      return;
    }
    navigate("/");
  });

  return (
    <main className="flex min-h-screen items-center justify-center font-sans text-gray-900">
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex w-[min(22rem,100%)] flex-col gap-4 rounded-xl border border-gray-200 p-8"
      >
        <h1 className="m-0 text-2xl font-bold">Sign in</h1>

        <label className="flex flex-col gap-1.5">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            className={`${inputClass} ${
              errors.email ? "border-red-600" : "border-gray-300"
            }`}
            {...register("email")}
          />
          {errors.email && <p className={errorClass}>{errors.email.message}</p>}
        </label>

        <label className="flex flex-col gap-1.5">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            className={`${inputClass} ${
              errors.password ? "border-red-600" : "border-gray-300"
            }`}
            {...register("password")}
          />
          {errors.password && (
            <p className={errorClass}>{errors.password.message}</p>
          )}
        </label>

        {errors.root && <p className={errorClass}>{errors.root.message}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="cursor-pointer rounded-md bg-gray-900 px-3 py-2.5 text-base text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
