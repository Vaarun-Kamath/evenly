import type { Group, Overview } from "@evenly/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Card,
  CheckboxField,
  EmptyState,
  ErrorState,
  LinkButton,
  Loading,
  PageHeader,
} from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { balanceSentence, money } from "../../lib/format";
import { groupsQuery, overviewQuery } from "../../lib/queries";

function Totals({ overview }: { overview: Overview }) {
  const active = overview.totals.filter((total) => total.owedToYou !== 0 || total.youOwe !== 0);
  if (active.length === 0) return null;
  return (
    <section aria-labelledby="totals-heading" className="mb-6 grid gap-3 sm:grid-cols-2">
      <h2 id="totals-heading" className="sr-only">
        Your totals
      </h2>
      {active.map((total) => (
        <Card key={total.currency} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{total.currency}</p>
          <p className="text-sm">
            <span className="text-muted">You are owed </span>
            <strong className="text-base">{money(total.owedToYou, total.currency)}</strong>
          </p>
          <p className="text-sm">
            <span className="text-muted">You owe </span>
            <strong className="text-base">{money(total.youOwe, total.currency)}</strong>
          </p>
        </Card>
      ))}
    </section>
  );
}

function People({ overview }: { overview: Overview }) {
  const withBalance = overview.people.filter((person) => person.balances.length > 0);
  if (withBalance.length === 0) return null;
  return (
    <details className="mb-6 rounded-2xl border border-line bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium">Balances with each person</summary>
      <ul className="mt-3 flex flex-col gap-2">
        {withBalance.map((person) => (
          <li
            key={person.userId}
            className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
          >
            <span className="font-medium">{person.name}</span>
            <span className="text-muted">
              {person.balances
                .map((b) =>
                  b.amountMinor > 0
                    ? `owes you ${money(b.amountMinor, b.currency)}`
                    : `you owe ${money(-b.amountMinor, b.currency)}`,
                )
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GroupCard({ group }: { group: Group }) {
  return (
    <li>
      <Link
        to="/g/$gid"
        params={{ gid: group.id }}
        className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition duration-300 ease-cream hover:bg-surface-2"
      >
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-xl"
        >
          {group.emoji ?? group.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {group.name}
            {group.archivedAt !== null && (
              <span className="ml-2 text-xs font-normal text-muted">(archived)</span>
            )}
          </span>
          <span className="block text-xs text-muted">
            {group.memberCount} {group.memberCount === 1 ? "person" : "people"} · {group.currency}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm">
          {group.myBalance.amountMinor === 0
            ? "Settled up"
            : balanceSentence(group.myBalance.amountMinor, group.currency)}
        </span>
      </Link>
    </li>
  );
}

export function DashboardPage() {
  const [showArchived, setShowArchived] = useState(false);
  const groups = useQuery(groupsQuery(showArchived ? "include" : "exclude"));
  const overview = useQuery(overviewQuery);

  return (
    <>
      <PageHeader
        title="Your groups"
        actions={<LinkButton to="/groups/new">New group</LinkButton>}
      />
      {overview.data !== undefined && (
        <>
          <Totals overview={overview.data} />
          <People overview={overview.data} />
        </>
      )}
      {groups.isPending && <Loading label="Loading your groups" />}
      {groups.isError && (
        <ErrorState message={errorMessage(groups.error)} onRetry={() => void groups.refetch()} />
      )}
      {groups.isSuccess &&
        (groups.data.length === 0 ? (
          <EmptyState
            title={showArchived ? "No groups yet" : "No groups yet"}
            action={<LinkButton to="/groups/new">Create your first group</LinkButton>}
          >
            A group is a trip, a flat or a night out. Add the people, then add expenses as they
            happen.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {groups.data.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </ul>
        ))}
      <div className="mt-6">
        <CheckboxField
          label="Show archived groups"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
      </div>
    </>
  );
}
