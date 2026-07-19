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

const fieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.35rem",
};
const inputStyle = {
  padding: "0.5rem",
  fontSize: "1rem",
  border: "1px solid #ccc",
  borderRadius: "0.25rem",
};
const invalidInputStyle = { ...inputStyle, border: "1px solid crimson" };
const errorStyle = { color: "crimson", margin: 0, fontSize: "0.85rem" };

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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        style={{
          width: "min(22rem, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          padding: "2rem",
          border: "1px solid #e2e2e2",
          borderRadius: "0.75rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Sign in</h1>

        <label style={fieldStyle}>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            style={errors.email ? invalidInputStyle : inputStyle}
            {...register("email")}
          />
          {errors.email && <p style={errorStyle}>{errors.email.message}</p>}
        </label>

        <label style={fieldStyle}>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            style={errors.password ? invalidInputStyle : inputStyle}
            {...register("password")}
          />
          {errors.password && (
            <p style={errorStyle}>{errors.password.message}</p>
          )}
        </label>

        {errors.root && <p style={errorStyle}>{errors.root.message}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{ padding: "0.6rem", fontSize: "1rem", cursor: "pointer" }}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
