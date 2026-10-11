import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Alert, Button, Card, TextField } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { auth, safeNext } from "../../lib/auth";
import { configQuery, keys, meQuery } from "../../lib/queries";

const emailSchema = z.email("Enter a valid email address.");
const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.");

/** Where to go after signing in: the page they came from, or the dashboard. */
function useAfterAuth() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (next: string | undefined) => {
    await queryClient.invalidateQueries({ queryKey: keys.me });
    await queryClient.fetchQuery(meQuery);
    await navigate({ to: safeNext(next) ?? "/" });
  };
}

export function LoginPage() {
  const search = useSearch({ from: "/login" });
  const config = useQuery(configQuery);
  const afterAuth = useAfterAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const login = useMutation({
    mutationFn: () => auth.signIn({ email: email.trim(), password }),
    onSuccess: () => afterAuth(search.next),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const emailResult = emailSchema.safeParse(email.trim());
    if (!emailResult.success) next.email = emailResult.error.issues[0]?.message ?? "Invalid email.";
    if (password === "") next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length === 0) login.mutate();
  }

  const signupsClosed = config.data?.signups === "closed";
  return (
    <Card as="section" className="flex flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-1 text-sm text-muted">Welcome back. Split expenses, evenly.</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        {login.isError && <Alert>{errorMessage(login.error)}</Alert>}
        <Button type="submit" loading={login.isPending}>
          Log in
        </Button>
      </form>
      <p className="flex flex-wrap justify-between gap-2 text-sm">
        <Link to="/reset" search={{}} className="underline underline-offset-4">
          Forgot your password?
        </Link>
        {!signupsClosed && (
          <span>
            New here?{" "}
            <Link
              to="/signup"
              search={search.next === undefined ? {} : { next: search.next }}
              className="font-medium underline underline-offset-4"
            >
              Create an account
            </Link>
          </span>
        )}
      </p>
    </Card>
  );
}

export function SignupPage() {
  const search = useSearch({ from: "/signup" });
  const config = useQuery(configQuery);
  const afterAuth = useAfterAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});

  const signUp = useMutation({
    mutationFn: () =>
      auth.signUp({
        name: name.trim(),
        email: email.trim(),
        password,
        ...(search.invite !== undefined && { inviteToken: search.invite }),
      }),
    onSuccess: () => afterAuth(search.next),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (name.trim() === "") next.name = "Enter your name.";
    else if (name.trim().length > 100) next.name = "Use at most 100 characters.";
    const emailResult = emailSchema.safeParse(email.trim());
    if (!emailResult.success) next.email = emailResult.error.issues[0]?.message ?? "Invalid email.";
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success)
      next.password = passwordResult.error.issues[0]?.message ?? "Invalid password.";
    setErrors(next);
    if (Object.keys(next).length === 0) signUp.mutate();
  }

  const signups = config.data?.signups;
  const blocked =
    signups === "closed" || (signups === "invite-only" && search.invite === undefined);
  return (
    <Card as="section" className="flex flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted">
          {search.invite === undefined
            ? "Free, with no limits on groups, expenses or friends."
            : "You are signing up to join a group you were invited to."}
        </p>
      </div>
      {blocked ? (
        <Alert tone="info">
          {signups === "closed"
            ? "This instance is not taking new accounts."
            : "This instance takes new accounts only through an invitation link. Ask the person who runs your group for one."}
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <TextField
            label="Your name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            hint="This is what other people in your groups see."
            required
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            required
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint="At least 10 characters. A few random words work well."
            required
          />
          {signUp.isError && <Alert>{errorMessage(signUp.error)}</Alert>}
          <Button type="submit" loading={signUp.isPending}>
            Create account
          </Button>
        </form>
      )}
      <p className="text-sm">
        Already have an account?{" "}
        <Link
          to="/login"
          search={search.next === undefined ? {} : { next: search.next }}
          className="font-medium underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </Card>
  );
}

/** Asks for a reset link, or (with a token from the link) sets the new password. */
export function ResetPage() {
  const search = useSearch({ from: "/reset" });
  const config = useQuery(configQuery);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();

  const request = useMutation({ mutationFn: () => auth.requestPasswordReset(email.trim()) });
  const reset = useMutation({
    mutationFn: () => auth.resetPassword({ token: search.token ?? "", newPassword: password }),
    onSuccess: () => navigate({ to: "/login", search: {} }),
  });

  if (search.token !== undefined) {
    return (
      <Card as="section" className="flex flex-col gap-5 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const result = passwordSchema.safeParse(password);
            setPasswordError(result.success ? undefined : result.error.issues[0]?.message);
            if (result.success) reset.mutate();
          }}
        >
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={passwordError}
            hint="At least 10 characters. Everywhere you are signed in will be signed out."
            required
          />
          {reset.isError && (
            <Alert>
              {errorMessage(reset.error)} The link may have expired or been used already; ask for a
              new one.
            </Alert>
          )}
          <Button type="submit" loading={reset.isPending}>
            Save new password
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card as="section" className="flex flex-col gap-5 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      {config.data?.emailEnabled === false ? (
        <Alert tone="info">
          This instance cannot send email, so it cannot send a reset link. Ask the person who runs
          it to create one for you with <code className="font-mono">reset-password</code>.
        </Alert>
      ) : request.isSuccess ? (
        <Alert tone="info">
          If an account has that address, a reset link is on its way. It works once, for one hour.
        </Alert>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (emailSchema.safeParse(email.trim()).success) request.mutate();
          }}
        >
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {request.isError && <Alert>{errorMessage(request.error)}</Alert>}
          <Button type="submit" loading={request.isPending}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" search={{}} className="text-sm underline underline-offset-4">
        Back to log in
      </Link>
    </Card>
  );
}
