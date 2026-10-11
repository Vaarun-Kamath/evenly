import type { ActivityItem, Balances, Expense, Group, Member } from "@evenly/contracts";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  Loading,
  PageHeader,
  SelectField,
  TextField,
} from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { balanceSentence, formatDate, formatDateTime, money, signedMoney } from "../../lib/format";
import { nameOf, useGid, useRefreshGroup, whoIs } from "../../lib/hooks";
import {
  activityInfiniteQuery,
  balancesQuery,
  expensesInfiniteQuery,
  groupQuery,
  membersQuery,
  type ExpenseFilters,
} from "../../lib/queries";
import { useToast } from "../../lib/toast";
import { describeActivity } from "./activityText";

const CATEGORY_LABELS: Record<string, string> = {
  food: "Food & drink",
  groceries: "Groceries",
  transport: "Transport",
  rent: "Rent",
  utilities: "Utilities",
  entertainment: "Entertainment",
  travel: "Travel",
  shopping: "Shopping",
  other: "Other",
};

/* ---------------------------------------------------------------- balances */

function BalancesCard({
  group,
  members,
  balances,
}: {
  group: Group;
  members: Member[];
  balances: Balances;
}) {
  const mine = group.myBalance.amountMinor;
  const others = balances.nets.filter((n) => n.net.amountMinor !== 0);
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-muted">Your balance</h2>
          <p className="text-xl font-semibold" data-testid="my-balance">
            {mine === 0 ? "Settled up" : balanceSentence(mine, group.currency)}
          </p>
        </div>
        <LinkButton
          to="/g/$gid/settle"
          params={{ gid: group.id }}
          variant={mine === 0 ? "secondary" : "primary"}
        >
          Settle up
        </LinkButton>
      </div>
      {others.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm underline underline-offset-4">
            Everyone&rsquo;s balance
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {balances.nets.map((n) => (
              <li key={n.memberId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{whoIs(members, n.memberId)}</span>
                <span className="shrink-0 tabular-nums">
                  {n.net.amountMinor === 0
                    ? "settled up"
                    : n.net.amountMinor > 0
                      ? `is owed ${money(n.net.amountMinor, group.currency)}`
                      : `owes ${money(-n.net.amountMinor, group.currency)}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- expenses */

function ExpenseRow({
  expense,
  members,
  gid,
}: {
  expense: Expense;
  members: Member[];
  gid: string;
}) {
  const me = members.find((m) => m.isYou);
  const currency = expense.amount.currency;
  const paid = expense.payers.find((p) => p.memberId === me?.id)?.amountMinor ?? 0;
  const share = expense.shares.find((s) => s.memberId === me?.id)?.amountMinor ?? 0;
  const net = paid - share;
  const involved = paid > 0 || share > 0;
  return (
    <li>
      <Link
        to="/g/$gid/expenses/$eid"
        params={{ gid, eid: expense.id }}
        className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 transition duration-300 ease-cream hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{expense.description}</span>
          <span className="block truncate text-xs text-muted">
            {formatDate(expense.expenseDate)} ·{" "}
            {CATEGORY_LABELS[expense.category] ?? expense.category} ·{" "}
            {expense.payers.map((p) => whoIs(members, p.memberId)).join(", ")} paid{" "}
            {money(expense.amount.amountMinor, currency)}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm">
          {involved ? (
            <>
              <span className="block tabular-nums font-medium">{signedMoney(net, currency)}</span>
              <span className="block text-xs text-muted">
                {net > 0 ? "you lent" : net < 0 ? "you owe" : "even"}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted">not involved</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function Filters({
  filters,
  onChange,
  members,
}: {
  filters: ExpenseFilters;
  onChange: (filters: ExpenseFilters) => void;
  members: Member[];
}) {
  const active = Object.values(filters).some((v) => v !== undefined && v !== "");
  const set = (patch: Partial<ExpenseFilters>) => onChange({ ...filters, ...patch });
  return (
    <details className="rounded-2xl border border-line bg-surface p-4" open={active}>
      <summary className="cursor-pointer text-sm font-medium">
        Search and filter{active ? " (on)" : ""}
      </summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TextField
          label="Search descriptions"
          type="search"
          value={filters.q ?? ""}
          onChange={(e) => set({ q: e.target.value === "" ? undefined : e.target.value })}
          className="sm:col-span-2"
        />
        <SelectField
          label="Category"
          value={filters.category ?? ""}
          onChange={(e) =>
            set({ category: (e.target.value || undefined) as ExpenseFilters["category"] })
          }
        >
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Person"
          value={filters.memberId ?? ""}
          onChange={(e) => set({ memberId: e.target.value || undefined })}
        >
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {nameOf(members, m.id)}
            </option>
          ))}
        </SelectField>
        <TextField
          label="From"
          type="date"
          value={filters.from ?? ""}
          onChange={(e) => set({ from: e.target.value || undefined })}
        />
        <TextField
          label="To"
          type="date"
          value={filters.to ?? ""}
          onChange={(e) => set({ to: e.target.value || undefined })}
        />
      </div>
      {active && (
        <Button variant="ghost" className="mt-3" onClick={() => onChange({})}>
          Clear filters
        </Button>
      )}
    </details>
  );
}

function Expenses({ group, members }: { group: Group; members: Member[] }) {
  const [filters, setFilters] = useState<ExpenseFilters>({});
  const deferred = useDeferredValue(filters);
  const list = useInfiniteQuery(expensesInfiniteQuery(group.id, deferred));
  const expenses = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtering = Object.values(filters).some((v) => v !== undefined && v !== "");

  return (
    <section aria-labelledby="expenses-heading" className="flex flex-col gap-3">
      <h2 id="expenses-heading" className="sr-only">
        Expenses
      </h2>
      <Filters filters={filters} onChange={setFilters} members={members} />
      {list.isPending && <Loading label="Loading expenses" />}
      {list.isError && (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      )}
      {list.isSuccess && expenses.length === 0 && (
        <EmptyState
          title={filtering ? "Nothing matches" : "No expenses yet"}
          action={
            filtering || group.archivedAt !== null ? undefined : (
              <LinkButton to="/g/$gid/expenses/new" params={{ gid: group.id }}>
                Add the first expense
              </LinkButton>
            )
          }
        >
          {filtering
            ? "Try changing or clearing the filters."
            : "Add what you spend together and Evenly keeps count."}
        </EmptyState>
      )}
      {expenses.length > 0 && (
        <ul className="flex flex-col gap-2">
          {expenses.map((expense) => (
            <ExpenseRow key={expense.id} expense={expense} members={members} gid={group.id} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => void list.fetchNextPage()}
          loading={list.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- activity */

function ActivityFeed({ group, members }: { group: Group; members: Member[] }) {
  const feed = useInfiniteQuery(activityInfiniteQuery(group.id));
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const isAdmin = group.myRole !== "member" && group.archivedAt === null;
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  const restore = useMutation({
    mutationFn: (item: ActivityItem) => {
      const kind = item.kind.startsWith("settlement") ? "settlements" : "expenses";
      return api("POST", `/api/v1/groups/${group.id}/${kind}/${item.entityId ?? ""}/restore`);
    },
    onSuccess: async () => {
      await refresh();
      toast.show("Restored.");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  // Offer "Restore" only on the latest event about an item, and only when that event is a delete.
  const seen = new Set<string>();
  const restorable = new Set<string>();
  for (const item of items) {
    if (item.entityId === null) continue;
    if (
      !seen.has(item.entityId) &&
      (item.kind === "expense.deleted" || item.kind === "settlement.deleted")
    ) {
      restorable.add(item.id);
    }
    seen.add(item.entityId);
  }

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h2 id="activity-heading" className="sr-only">
        Activity
      </h2>
      {feed.isPending && <Loading label="Loading activity" />}
      {feed.isError && (
        <ErrorState message={errorMessage(feed.error)} onRetry={() => void feed.refetch()} />
      )}
      {feed.isSuccess && items.length === 0 && <EmptyState title="Nothing has happened yet" />}
      {items.length > 0 && (
        <ol className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-sm"
            >
              <div className="min-w-0">
                <p>
                  <strong>
                    {item.actor === null ? "Evenly" : whoIs(members, item.actor.memberId)}
                  </strong>{" "}
                  {describeActivity(item, members, group.currency)}
                </p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(item.createdAt)}</p>
              </div>
              {isAdmin && restorable.has(item.id) && (
                <Button
                  variant="secondary"
                  className="min-h-9 shrink-0 px-3"
                  loading={restore.isPending && restore.variables?.id === item.id}
                  onClick={() => restore.mutate(item)}
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {feed.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => void feed.fetchNextPage()}
          loading={feed.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- page */

export function GroupPage() {
  const gid = useGid();
  const { tab } = useSearch({ from: "/authed/g/$gid" });
  const navigate = useNavigate();
  const group = useQuery(groupQuery(gid));
  const members = useQuery(membersQuery(gid));
  const balances = useQuery(balancesQuery(gid));

  if (group.isPending || members.isPending) return <Loading label="Loading the group" />;
  if (group.isError || members.isError) {
    return (
      <>
        <Link to="/" className="text-sm underline underline-offset-4">
          Back to your groups
        </Link>
        <div className="mt-4">
          <ErrorState message={errorMessage(group.error ?? members.error)} />
        </div>
      </>
    );
  }

  const archived = group.data.archivedAt !== null;
  const showTab = tab === "activity" ? "activity" : "expenses";
  return (
    <>
      <PageHeader
        title={
          <>
            {group.data.emoji !== null && <span aria-hidden="true">{group.data.emoji} </span>}
            {group.data.name}
          </>
        }
        subtitle={
          <>
            {group.data.memberCount} {group.data.memberCount === 1 ? "person" : "people"} ·{" "}
            {group.data.currency} {archived && <Badge>Archived</Badge>}
          </>
        }
        back={
          <Link to="/" className="text-sm underline underline-offset-4">
            Your groups
          </Link>
        }
        actions={
          <>
            {!archived && (
              <LinkButton to="/g/$gid/expenses/new" params={{ gid }}>
                Add expense
              </LinkButton>
            )}
            <LinkButton to="/g/$gid/settings" params={{ gid }} variant="secondary">
              Settings
            </LinkButton>
          </>
        }
      />
      {archived && (
        <Alert tone="info" className="mb-4">
          This group is archived: you can look, but not change anything. An admin can unarchive it
          in Settings.
        </Alert>
      )}
      <div className="flex flex-col gap-5">
        {balances.data !== undefined ? (
          <BalancesCard group={group.data} members={members.data} balances={balances.data} />
        ) : balances.isError ? (
          <ErrorState
            message={errorMessage(balances.error)}
            onRetry={() => void balances.refetch()}
          />
        ) : (
          <Loading label="Loading balances" />
        )}

        <div
          role="tablist"
          aria-label="Group sections"
          className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
        >
          {(["expenses", "activity"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={showTab === id}
              aria-controls={`panel-${id}`}
              tabIndex={showTab === id ? 0 : -1}
              onClick={() =>
                void navigate({
                  to: "/g/$gid",
                  params: { gid },
                  search: id === "activity" ? { tab: "activity" } : {},
                  replace: true,
                })
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  const other = id === "expenses" ? "activity" : "expenses";
                  void navigate({
                    to: "/g/$gid",
                    params: { gid },
                    search: other === "activity" ? { tab: "activity" } : {},
                    replace: true,
                  });
                  window.setTimeout(() => document.getElementById(`tab-${other}`)?.focus(), 0);
                }
              }}
              className="min-h-10 rounded-lg text-sm font-medium aria-selected:bg-surface aria-selected:shadow-sm"
            >
              {id === "expenses" ? "Expenses" : "Activity"}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${showTab}`} aria-labelledby={`tab-${showTab}`}>
          {showTab === "expenses" ? (
            <Expenses group={group.data} members={members.data} />
          ) : (
            <ActivityFeed group={group.data} members={members.data} />
          )}
        </div>
      </div>
    </>
  );
}
