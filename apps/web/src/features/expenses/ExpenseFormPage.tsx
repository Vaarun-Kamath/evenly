import { expenseSchema, type Expense, type Group, type Member } from "@evenly/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Loading,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { ApiError, api, errorMessage } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { nameOf, useGid, useRefreshGroup, whoIs } from "../../lib/hooks";
import { expenseQuery, groupQuery, membersQuery } from "../../lib/queries";
import { useToast } from "../../lib/toast";
import { differences } from "./conflict";
import { SplitEditor } from "./SplitEditor";
import {
  clearDraft,
  compute,
  createRequest,
  initialState,
  isValid,
  loadDraft,
  saveDraft,
  stateFromExpense,
  updateRequest,
  visibleMembers,
  type ExpenseFormState,
} from "./formState";

const CATEGORIES = [
  ["food", "Food & drink"],
  ["groceries", "Groceries"],
  ["transport", "Transport"],
  ["rent", "Rent"],
  ["utilities", "Utilities"],
  ["entertainment", "Entertainment"],
  ["travel", "Travel"],
  ["shopping", "Shopping"],
  ["other", "Other"],
] as const;

function BackLink({ gid }: { gid: string }) {
  return (
    <Link to="/g/$gid" params={{ gid }} className="text-sm underline underline-offset-4">
      Back to the group
    </Link>
  );
}

/** `/g/:gid/expenses/new`. */
export function NewExpensePage() {
  return <ExpensePage />;
}

/** `/g/:gid/expenses/:eid`. */
export function EditExpensePage() {
  const { eid } = useParams({ strict: false });
  return <ExpensePage {...(eid !== undefined && { expenseId: eid })} />;
}

function ExpensePage({ expenseId }: { expenseId?: string }) {
  const gid = useGid();
  const group = useQuery(groupQuery(gid));
  const members = useQuery(membersQuery(gid));
  const expense = useQuery({
    ...expenseQuery(gid, expenseId ?? "none"),
    enabled: expenseId !== undefined,
  });

  const failed = group.error ?? members.error ?? expense.error;
  if (failed !== null) {
    return (
      <>
        <BackLink gid={gid} />
        <div className="mt-4">
          <ErrorState message={errorMessage(failed)} />
        </div>
      </>
    );
  }
  if (
    group.data === undefined ||
    members.data === undefined ||
    (expenseId !== undefined && expense.data === undefined)
  ) {
    return <Loading label="Loading the expense" />;
  }
  if (expense.data?.deletedAt != null) {
    return (
      <DeletedExpense gid={gid} expense={expense.data} group={group.data} members={members.data} />
    );
  }
  return (
    <ExpenseForm
      key={expense.data?.version ?? "new"}
      gid={gid}
      group={group.data}
      members={members.data}
      expense={expense.data}
    />
  );
}

function ExpenseForm({
  gid,
  group,
  members,
  expense,
}: {
  gid: string;
  group: Group;
  members: Member[];
  expense: Expense | undefined;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshGroup(gid);
  const editing = expense !== undefined;
  const archived = group.archivedAt !== null;

  const offered = useMemo(() => visibleMembers(members, expense), [members, expense]);
  const [state, setState] = useState<ExpenseFormState>(() => {
    if (expense !== undefined) return stateFromExpense(expense, members);
    // A half-typed new expense survives a reload, as long as it is still valid for this group.
    const draft = loadDraft(gid);
    return draft ?? initialState(members, uuidv7());
  });
  const [showErrors, setShowErrors] = useState(false);
  const [conflict, setConflict] = useState<Expense>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const computed = useMemo(
    () => compute(state, members, group.currency),
    [state, members, group.currency],
  );
  const request = editing
    ? updateRequest(state, computed, group.currency, expense.version)
    : createRequest(state, computed, group.currency);

  // Keep a new expense as a draft in the tab (see formState.ts).
  const firstRender = useRef(true);
  useEffect(() => {
    if (editing) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    saveDraft(gid, state);
  }, [state, gid, editing]);

  const save = useMutation({
    mutationFn: (body: typeof request) =>
      editing
        ? api("PATCH", `/api/v1/groups/${gid}/expenses/${expense.id}`, {
            body,
            schema: expenseSchema,
          })
        : api("POST", `/api/v1/groups/${gid}/expenses`, { body, schema: expenseSchema }),
    onSuccess: async () => {
      clearDraft(gid);
      await refresh();
      toast.show(editing ? "Expense updated." : "Expense added.");
      await navigate({ to: "/g/$gid", params: { gid } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "version-conflict") {
        const parsed = expenseSchema.safeParse(error.problem?.current);
        if (parsed.success) setConflict(parsed.data);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api("DELETE", `/api/v1/groups/${gid}/expenses/${expense?.id ?? ""}`),
    onSuccess: async () => {
      await refresh();
      toast.show("Expense deleted. An admin can restore it.");
      await navigate({ to: "/g/$gid", params: { gid } });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (state.description.trim() === "" || !isValid(state, computed)) return;
    save.mutate(request);
  }

  const descriptionError =
    showErrors && state.description.trim() === "" ? "Say what it was for." : undefined;
  const shown = (message: string | undefined) => (showErrors ? message : undefined);
  const conflictRows =
    conflict === undefined || !editing
      ? []
      : differences(
          conflict,
          updateRequest(state, computed, group.currency, conflict.version),
          members,
        );

  return (
    <>
      <PageHeader
        title={editing ? "Edit expense" : "Add expense"}
        subtitle={`${group.emoji ?? ""} ${group.name}`.trim()}
        back={<BackLink gid={gid} />}
      />
      {archived && (
        <Alert tone="info" className="mb-4">
          This group is archived, so expenses cannot be changed.
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Card className="flex flex-col gap-4">
          <TextField
            label="What was it for?"
            value={state.description}
            onChange={(e) => setState({ ...state, description: e.target.value })}
            error={descriptionError}
            maxLength={200}
            placeholder="Dinner"
            autoFocus={!editing}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={`Amount (${group.currency})`}
              inputMode="decimal"
              autoComplete="off"
              value={state.amount}
              onChange={(e) => setState({ ...state, amount: e.target.value })}
              error={shown(computed.errors.amount)}
              placeholder="0.00"
              required
            />
            <TextField
              label="Date"
              type="date"
              value={state.date}
              onChange={(e) => setState({ ...state, date: e.target.value })}
              required
            />
          </div>
          <SelectField
            label="Category"
            value={state.category}
            onChange={(e) =>
              setState({ ...state, category: e.target.value as ExpenseFormState["category"] })
            }
          >
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </Card>

        <Card className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-3">
            <legend className={state.payerMode === "one" ? "sr-only" : "mb-1 text-sm font-medium"}>
              {state.payerMode === "one" ? "Paid by" : "Who paid, and how much each"}
            </legend>
            {state.payerMode === "one" ? (
              <SelectField
                label="Paid by"
                value={state.payer}
                onChange={(e) => setState({ ...state, payer: e.target.value })}
                error={shown(computed.errors.payers)}
              >
                {offered.map((m) => (
                  <option key={m.id} value={m.id}>
                    {nameOf(members, m.id)}
                    {m.isYou ? " (you)" : ""}
                  </option>
                ))}
              </SelectField>
            ) : (
              <ul className="flex flex-col gap-2">
                {offered.map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <label htmlFor={`paid-${m.id}`} className="min-w-0 flex-1 truncate text-sm">
                      {nameOf(members, m.id)}
                      {m.isYou ? " (you)" : ""}
                    </label>
                    <input
                      id={`paid-${m.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      disabled={m.leftAt !== null}
                      value={state.payerAmounts[m.id] ?? ""}
                      onChange={(e) =>
                        setState({
                          ...state,
                          payerAmounts: { ...state.payerAmounts, [m.id]: e.target.value },
                        })
                      }
                      className="min-h-10 w-28 rounded-lg border border-line bg-surface px-2 text-right text-sm"
                    />
                  </li>
                ))}
              </ul>
            )}
            {state.payerMode === "many" && shown(computed.errors.payers) !== undefined && (
              <p role="alert" className="text-sm text-danger">
                {computed.errors.payers}
              </p>
            )}
            <CheckboxField
              label="Several people paid"
              checked={state.payerMode === "many"}
              onChange={(e) =>
                setState({
                  ...state,
                  payerMode: e.target.checked ? "many" : "one",
                  payerAmounts:
                    e.target.checked && state.payer !== "" && state.amount !== ""
                      ? { [state.payer]: state.amount }
                      : state.payerAmounts,
                })
              }
            />
          </fieldset>
        </Card>

        <Card>
          <SplitEditor
            state={state}
            onChange={setState}
            members={offered}
            allMembers={members}
            computed={computed}
            currency={group.currency}
          />
        </Card>

        <Card>
          <TextAreaField
            label="Notes (optional)"
            value={state.notes}
            onChange={(e) => setState({ ...state, notes: e.target.value })}
            maxLength={2000}
          />
        </Card>

        {save.isError &&
          !(save.error instanceof ApiError && save.error.code === "version-conflict") && (
            <Alert>{errorMessage(save.error)}</Alert>
          )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" loading={save.isPending} disabled={archived} className="min-w-40">
            {editing ? "Save changes" : "Add expense"}
          </Button>
          {editing && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={archived}>
              Delete expense
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this expense?"
        confirmLabel="Delete"
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      >
        <p>
          &ldquo;{expense?.description}&rdquo; will disappear from balances. An admin of the group
          can restore it later from the activity feed.
        </p>
        {remove.isError && <Alert className="mt-3">{errorMessage(remove.error)}</Alert>}
      </ConfirmDialog>

      <Dialog
        open={conflict !== undefined}
        onClose={() => setConflict(undefined)}
        title="Someone else changed this expense"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflict(undefined)}>
              Keep editing
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (conflict !== undefined) {
                  setState(stateFromExpense(conflict, members));
                  setConflict(undefined);
                  void refresh();
                }
              }}
            >
              Use their version
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                if (conflict !== undefined) {
                  setConflict(undefined);
                  save.mutate({ ...request, version: conflict.version });
                }
              }}
            >
              Save mine anyway
            </Button>
          </>
        }
      >
        <p className="mb-3">
          While you were editing, the expense was saved by someone else. Here is what differs from
          your version.
        </p>
        {conflictRows.length === 0 ? (
          <p className="text-muted">
            The visible fields are the same; the split or the amounts per person may differ.
          </p>
        ) : (
          <dl className="flex flex-col gap-2">
            {conflictRows.map((row) => (
              <div key={row.label} className="rounded-lg bg-surface-2 p-2">
                <dt className="text-xs font-medium text-muted">{row.label}</dt>
                <dd>
                  <span className="font-medium">Theirs:</span> {row.theirs}
                </dd>
                <dd>
                  <span className="font-medium">Yours:</span> {row.mine}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Dialog>
    </>
  );
}

/** A deleted expense is shown read-only; an admin can bring it back. */
function DeletedExpense({
  gid,
  expense,
  group,
  members,
}: {
  gid: string;
  expense: Expense;
  group: Group;
  members: Member[];
}) {
  const refresh = useRefreshGroup(gid);
  const toast = useToast();
  const restore = useMutation({
    mutationFn: () =>
      api("POST", `/api/v1/groups/${gid}/expenses/${expense.id}/restore`, {
        schema: expenseSchema,
      }),
    onSuccess: async () => {
      await refresh();
      toast.show("Expense restored.");
    },
  });
  const currency = expense.amount.currency;
  return (
    <>
      <PageHeader
        title={expense.description}
        subtitle={formatDate(expense.expenseDate)}
        back={<BackLink gid={gid} />}
      />
      <Alert tone="info" className="mb-4">
        This expense was deleted, so it does not count toward anyone&rsquo;s balance.
      </Alert>
      <Card className="flex flex-col gap-3 text-sm">
        <p>
          <strong>{money(expense.amount.amountMinor, currency)}</strong> paid by{" "}
          {expense.payers
            .map((p) => `${whoIs(members, p.memberId)} (${money(p.amountMinor, currency)})`)
            .join(", ")}
        </p>
        <ul className="flex flex-col gap-1">
          {expense.shares.map((s) => (
            <li key={s.memberId} className="flex justify-between">
              <span>{whoIs(members, s.memberId)}</span>
              <span>{money(s.amountMinor, currency)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {group.myRole === "member" ? (
        <p className="mt-4 text-sm text-muted">An admin of the group can restore it.</p>
      ) : (
        <div className="mt-4">
          {restore.isError && <Alert className="mb-3">{errorMessage(restore.error)}</Alert>}
          <Button
            onClick={() => restore.mutate()}
            loading={restore.isPending}
            disabled={group.archivedAt !== null}
          >
            Restore expense
          </Button>
        </div>
      )}
    </>
  );
}
