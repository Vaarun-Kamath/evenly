import { CURRENCY_EXPONENTS } from "@evenly/core";
import { meResponseSchema } from "@evenly/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Loading,
  PageHeader,
  SelectField,
  TextField,
} from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { auth } from "../../lib/auth";
import { currencyLabel } from "../../lib/format";
import { keys, meQuery } from "../../lib/queries";
import { useToast } from "../../lib/toast";

const CURRENCIES = Object.keys(CURRENCY_EXPONENTS).sort();

export function AccountPage() {
  const me = useQuery(meQuery);
  if (me.isPending) return <Loading label="Loading your account" />;
  if (me.isError) return <ErrorState message={errorMessage(me.error)} />;
  return (
    <>
      <PageHeader title="Your account" subtitle={me.data.email} />
      <div className="flex flex-col gap-6">
        <Profile name={me.data.name} currency={me.data.defaultCurrency} />
        <Password />
        <Sessions />
        <DeleteAccount />
      </div>
    </>
  );
}

function Profile({
  name: initialName,
  currency: initialCurrency,
}: {
  name: string;
  currency: string | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [currency, setCurrency] = useState(initialCurrency ?? "");
  const [nameError, setNameError] = useState<string>();

  const save = useMutation({
    mutationFn: () =>
      api("PATCH", "/api/v1/me", {
        body: { name: name.trim(), defaultCurrency: currency === "" ? null : currency },
        schema: meResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      await queryClient.invalidateQueries({ queryKey: keys.allGroups });
      toast.show("Profile saved.");
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return setNameError("Enter your name.");
    setNameError(undefined);
    save.mutate();
  }

  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Profile</h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          maxLength={100}
          hint="Changing it updates your name in every group."
        />
        <SelectField
          label="Default currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          hint="Suggested when you create a group."
        >
          <option value="">No preference</option>
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {currencyLabel(code)}
            </option>
          ))}
        </SelectField>
        {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
        <Button type="submit" loading={save.isPending} className="self-start">
          Save profile
        </Button>
      </form>
    </Card>
  );
}

function Password() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string>();
  const change = useMutation({
    mutationFn: () => auth.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      toast.show("Password changed. Your other devices were signed out.");
    },
  });
  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Password</h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (current === "") return setError("Enter your current password.");
          if (next.length < 10) return setError("The new password needs at least 10 characters.");
          setError(undefined);
          change.mutate();
        }}
      >
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint="At least 10 characters."
        />
        {error !== undefined && <Alert>{error}</Alert>}
        {change.isError && <Alert>{errorMessage(change.error)}</Alert>}
        <Button type="submit" variant="secondary" loading={change.isPending} className="self-start">
          Change password
        </Button>
      </form>
    </Card>
  );
}

function Sessions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const out = useMutation({
    mutationFn: () => auth.signOutEverywhere(),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/login", search: {} });
    },
  });
  return (
    <Card as="section" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Sessions</h2>
      <p className="text-sm text-muted">
        Sign out of every device you are logged in on, including this one.
      </p>
      {out.isError && <Alert>{errorMessage(out.error)}</Alert>}
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => out.mutate()}
        loading={out.isPending}
      >
        Log out everywhere
      </Button>
    </Card>
  );
}

function DeleteAccount() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api("DELETE", "/api/v1/me", { body: { password } }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/login", search: {} });
    },
  });
  return (
    <Card as="section" className="flex flex-col gap-3 border-danger">
      <h2 className="text-lg font-semibold text-danger">Delete account</h2>
      <p className="text-sm">
        You can delete your account when you own no group and are settled up everywhere. Your name
        is replaced by &ldquo;Deleted user&rdquo; in the groups you were in, so their history stays
        correct.
      </p>
      <Button variant="danger" className="self-start" onClick={() => setOpen(true)}>
        Delete account…
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete your account?"
        confirmLabel="Delete account"
        busy={remove.isPending}
        onCancel={() => {
          setOpen(false);
          setPassword("");
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
      >
        <div className="flex flex-col gap-3">
          <p>This cannot be undone. Enter your password to confirm.</p>
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {remove.isError && <Alert>{errorMessage(remove.error)}</Alert>}
        </div>
      </ConfirmDialog>
    </Card>
  );
}
