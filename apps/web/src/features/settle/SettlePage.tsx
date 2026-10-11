import {
  settlementSchema,
  type Balances,
  type Group,
  type Member,
  type Settlement,
} from "@evenly/contracts";
import { exponentOf, parseAmount, unitsToDecimalString } from "@evenly/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  SelectField,
  TextField,
} from "../../components/ui";
import { ApiError, api, errorMessage } from "../../lib/api";
import { formatDate, money, todayIso } from "../../lib/format";
import { nameOf, useGid, useRefreshGroup, whoIs } from "../../lib/hooks";
import { balancesQuery, groupQuery, membersQuery, settlementsQuery } from "../../lib/queries";
import { useToast } from "../../lib/toast";
import { describeCoreError } from "../expenses/formState";

function sentence(members: Member[], from: string, to: string, text: string): string {
  const fromYou = members.find((m) => m.id === from)?.isYou === true;
  const toYou = members.find((m) => m.id === to)?.isYou === true;
  if (fromYou) return `You pay ${nameOf(members, to)} ${text}`;
  if (toYou) return `${nameOf(members, from)} pays you ${text}`;
  return `${nameOf(members, from)} pays ${nameOf(members, to)} ${text}`;
}

/* ------------------------------------------------------------- one payment */

function Suggestions({
  group,
  members,
  balances,
  readOnly,
}: {
  group: Group;
  members: Member[];
  balances: Balances;
  readOnly: boolean;
}) {
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const record = useMutation({
    mutationFn: (payment: Balances["suggested"][number]) =>
      api("POST", `/api/v1/groups/${group.id}/settlements`, {
        body: {
          id: uuidv7(),
          fromMemberId: payment.fromMemberId,
          toMemberId: payment.toMemberId,
          amountMinor: payment.amount.amountMinor,
          currency: group.currency,
          settledOn: todayIso(),
          note: null,
        },
        schema: settlementSchema,
      }),
    onSuccess: async () => {
      await refresh();
      toast.show("Payment recorded.");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  if (balances.suggested.length === 0) {
    return (
      <EmptyState title="Everyone is settled up">
        Nobody owes anybody anything right now.
      </EmptyState>
    );
  }
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        {balances.simplifyDebts
          ? "The fewest payments that settle everyone. One tap records a payment, with the amount filled in."
          : "Who owes whom, from the individual expenses. One tap records a payment, with the amount filled in."}
      </p>
      <ul className="flex flex-col gap-2">
        {balances.suggested.map((payment) => (
          <li key={`${payment.fromMemberId}-${payment.toMemberId}`}>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-sm">
                {sentence(members, payment.fromMemberId, payment.toMemberId, "")}
                <strong className="ml-1 text-base">
                  {money(payment.amount.amountMinor, group.currency)}
                </strong>
              </p>
              {!readOnly && (
                <Button
                  onClick={() => record.mutate(payment)}
                  loading={record.isPending && record.variables === payment}
                  disabled={record.isPending}
                  aria-label={`Record payment: ${sentence(members, payment.fromMemberId, payment.toMemberId, money(payment.amount.amountMinor, group.currency))}`}
                >
                  Record payment
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------- the form */

interface FormValues {
  from: string;
  to: string;
  amount: string;
  date: string;
  note: string;
}

function PaymentForm({
  group,
  members,
  initial,
  settlement,
  onDone,
  submitLabel,
}: {
  group: Group;
  members: Member[];
  initial?: FormValues;
  settlement?: Settlement;
  onDone: () => void;
  submitLabel: string;
}) {
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const active = members.filter(
    (m) =>
      m.leftAt === null || m.id === settlement?.fromMemberId || m.id === settlement?.toMemberId,
  );
  const me = members.find((m) => m.isYou);
  const [values, setValues] = useState<FormValues>(
    initial ?? { from: me?.id ?? "", to: "", amount: "", date: todayIso(), note: "" },
  );
  const [errors, setErrors] = useState<{ from?: string; to?: string; amount?: string }>({});

  const save = useMutation({
    mutationFn: (amountMinor: number) => {
      const body = {
        fromMemberId: values.from,
        toMemberId: values.to,
        amountMinor,
        currency: group.currency,
        settledOn: values.date,
        note: values.note.trim() === "" ? null : values.note.trim(),
      };
      return settlement === undefined
        ? api("POST", `/api/v1/groups/${group.id}/settlements`, {
            body: { id: uuidv7(), ...body },
            schema: settlementSchema,
          })
        : api("PATCH", `/api/v1/groups/${group.id}/settlements/${settlement.id}`, {
            body: { ...body, version: settlement.version },
            schema: settlementSchema,
          });
    },
    onSuccess: async () => {
      await refresh();
      toast.show(settlement === undefined ? "Payment recorded." : "Payment updated.");
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (values.from === "") next.from = "Choose who paid.";
    if (values.to === "") next.to = "Choose who received the money.";
    else if (values.to === values.from) next.to = "Choose a different person.";
    let amountMinor = 0;
    try {
      amountMinor = parseAmount(values.amount, group.currency);
      if (amountMinor < 1) next.amount = "The amount must be above zero.";
    } catch (error) {
      next.amount = describeCoreError(error, group.currency);
    }
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate(amountMinor);
  }

  const set = (patch: Partial<FormValues>) => setValues({ ...values, ...patch });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Who paid?"
          value={values.from}
          onChange={(e) => set({ from: e.target.value })}
          error={errors.from}
        >
          <option value="">Choose…</option>
          {active.map((m) => (
            <option key={m.id} value={m.id}>
              {nameOf(members, m.id)}
              {m.isYou ? " (you)" : ""}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Who received it?"
          value={values.to}
          onChange={(e) => set({ to: e.target.value })}
          error={errors.to}
        >
          <option value="">Choose…</option>
          {active.map((m) => (
            <option key={m.id} value={m.id}>
              {nameOf(members, m.id)}
              {m.isYou ? " (you)" : ""}
            </option>
          ))}
        </SelectField>
        <TextField
          label={`Amount (${group.currency})`}
          inputMode="decimal"
          autoComplete="off"
          value={values.amount}
          onChange={(e) => set({ amount: e.target.value })}
          error={errors.amount}
          placeholder="0.00"
        />
        <TextField
          label="Date"
          type="date"
          value={values.date}
          onChange={(e) => set({ date: e.target.value })}
          required
        />
      </div>
      <TextField
        label="Note (optional)"
        value={values.note}
        onChange={(e) => set({ note: e.target.value })}
        maxLength={500}
      />
      {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------- the list */

function Payments({
  group,
  members,
  readOnly,
}: {
  group: Group;
  members: Member[];
  readOnly: boolean;
}) {
  const payments = useQuery(settlementsQuery(group.id));
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const [editing, setEditing] = useState<Settlement>();
  const [deleting, setDeleting] = useState<Settlement>();

  const remove = useMutation({
    mutationFn: (settlement: Settlement) =>
      api("DELETE", `/api/v1/groups/${group.id}/settlements/${settlement.id}`),
    onSuccess: async () => {
      setDeleting(undefined);
      await refresh();
      toast.show("Payment deleted. An admin can restore it from the activity feed.");
    },
  });

  if (payments.isPending) return <Loading label="Loading payments" />;
  if (payments.isError)
    return (
      <ErrorState message={errorMessage(payments.error)} onRetry={() => void payments.refetch()} />
    );
  if (payments.data.items.length === 0) return <EmptyState title="No payments recorded yet" />;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {payments.data.items.map((p) => (
          <li key={p.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <p>
                  <strong>{whoIs(members, p.fromMemberId)}</strong> paid{" "}
                  <strong>{whoIs(members, p.toMemberId)}</strong>{" "}
                  {money(p.amount.amountMinor, group.currency)}
                </p>
                <p className="text-xs text-muted">
                  {formatDate(p.settledOn)}
                  {p.note !== null && ` · ${p.note}`}
                </p>
              </div>
              {!readOnly && (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-9 px-3"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </Button>
                  <Button variant="danger" className="min-h-9 px-3" onClick={() => setDeleting(p)}>
                    Delete
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      <Dialog
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title="Edit payment"
      >
        {editing !== undefined && (
          <PaymentForm
            key={`${editing.id}-${String(editing.version)}`}
            group={group}
            members={members}
            settlement={editing}
            initial={{
              from: editing.fromMemberId,
              to: editing.toMemberId,
              amount: unitsToDecimalString(editing.amount.amountMinor, exponentOf(group.currency)),
              date: editing.settledOn,
              note: editing.note ?? "",
            }}
            submitLabel="Save changes"
            onDone={() => setEditing(undefined)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== undefined}
        title="Delete this payment?"
        confirmLabel="Delete"
        busy={remove.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => deleting !== undefined && remove.mutate(deleting)}
      >
        {deleting !== undefined && (
          <p>
            {whoIs(members, deleting.fromMemberId)} paid {whoIs(members, deleting.toMemberId)}{" "}
            {money(deleting.amount.amountMinor, group.currency)}. Balances will change back as if it
            never happened.
          </p>
        )}
        {remove.isError && (
          <Alert className="mt-3">
            {remove.error instanceof ApiError ? remove.error.message : errorMessage(remove.error)}
          </Alert>
        )}
      </ConfirmDialog>
    </>
  );
}

/* ------------------------------------------------------------- the page */

export function SettlePage() {
  const gid = useGid();
  const group = useQuery(groupQuery(gid));
  const members = useQuery(membersQuery(gid));
  const balances = useQuery(balancesQuery(gid));

  const failed = group.error ?? members.error ?? balances.error;
  if (failed !== null) return <ErrorState message={errorMessage(failed)} />;
  if (group.data === undefined || members.data === undefined || balances.data === undefined) {
    return <Loading label="Loading balances" />;
  }
  const readOnly = group.data.archivedAt !== null;
  const withMe = members.data.find((m) => m.isYou);

  return (
    <>
      <PageHeader
        title="Settle up"
        subtitle={`${group.data.emoji ?? ""} ${group.data.name}`.trim()}
        back={
          <Link to="/g/$gid" params={{ gid }} className="text-sm underline underline-offset-4">
            Back to the group
          </Link>
        }
      />
      {readOnly && (
        <Alert tone="info" className="mb-4">
          This group is archived, so payments cannot be changed.
        </Alert>
      )}
      <div className="flex flex-col gap-8">
        <section aria-labelledby="suggested-heading">
          <h2 id="suggested-heading" className="mb-3 text-lg font-semibold">
            Suggested payments
          </h2>
          <Suggestions
            group={group.data}
            members={members.data}
            balances={balances.data}
            readOnly={readOnly}
          />
        </section>

        {!readOnly && (
          <section aria-labelledby="record-heading">
            <details className="rounded-2xl border border-line bg-surface p-4">
              <summary id="record-heading" className="cursor-pointer text-sm font-medium">
                Record a different payment
              </summary>
              <div className="mt-4">
                <PaymentForm
                  group={group.data}
                  members={members.data}
                  initial={{
                    from: withMe?.id ?? "",
                    to: "",
                    amount: "",
                    date: todayIso(),
                    note: "",
                  }}
                  submitLabel="Record payment"
                  onDone={() => undefined}
                />
              </div>
            </details>
          </section>
        )}

        <section aria-labelledby="payments-heading">
          <h2 id="payments-heading" className="mb-3 text-lg font-semibold">
            Payments so far
          </h2>
          <Payments group={group.data} members={members.data} readOnly={readOnly} />
        </section>
      </div>
    </>
  );
}
