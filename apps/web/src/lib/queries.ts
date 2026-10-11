import {
  activityItemSchema,
  balancesSchema,
  expenseSchema,
  groupSchema,
  instanceConfigSchema,
  invitePreviewSchema,
  inviteSchema,
  memberSchema,
  meResponseSchema,
  overviewSchema,
  pageSchema,
  settlementSchema,
  type ListExpensesQuery,
} from "@evenly/contracts";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

/** Every server-state query in one place, so keys stay consistent and invalidation is easy to reason about. */
export const keys = {
  me: ["me"] as const,
  config: ["config"] as const,
  groups: (archived: string) => ["groups", archived] as const,
  allGroups: ["groups"] as const,
  group: (gid: string) => ["group", gid] as const,
  members: (gid: string) => ["members", gid] as const,
  balances: (gid: string) => ["balances", gid] as const,
  expenses: (gid: string, filters: object) => ["expenses", gid, filters] as const,
  allExpenses: (gid: string) => ["expenses", gid] as const,
  expense: (gid: string, eid: string) => ["expense", gid, eid] as const,
  settlements: (gid: string) => ["settlements", gid] as const,
  invites: (gid: string) => ["invites", gid] as const,
  activity: (gid: string) => ["activity", gid] as const,
  overview: ["overview"] as const,
  invitePreview: (token: string) => ["invite-preview", token] as const,
};

const group = (gid: string) => `/api/v1/groups/${gid}`;

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: () => api("GET", "/api/v1/me", { schema: meResponseSchema }),
  staleTime: 60_000,
  retry: false,
});

export const configQuery = queryOptions({
  queryKey: keys.config,
  queryFn: () => api("GET", "/api/v1/config", { schema: instanceConfigSchema }),
  staleTime: 5 * 60_000,
});

export const groupsQuery = (archived: "exclude" | "only" | "include" = "exclude") =>
  queryOptions({
    queryKey: keys.groups(archived),
    queryFn: () =>
      api("GET", `/api/v1/groups?archived=${archived}`, { schema: z.array(groupSchema) }),
  });

export const groupQuery = (gid: string) =>
  queryOptions({
    queryKey: keys.group(gid),
    queryFn: () => api("GET", group(gid), { schema: groupSchema }),
  });

export const membersQuery = (gid: string) =>
  queryOptions({
    queryKey: keys.members(gid),
    queryFn: () => api("GET", `${group(gid)}/members`, { schema: z.array(memberSchema) }),
  });

export const balancesQuery = (gid: string) =>
  queryOptions({
    queryKey: keys.balances(gid),
    queryFn: () => api("GET", `${group(gid)}/balances`, { schema: balancesSchema }),
  });

export const overviewQuery = queryOptions({
  queryKey: keys.overview,
  queryFn: () => api("GET", "/api/v1/me/overview", { schema: overviewSchema }),
});

export const invitesQuery = (gid: string) =>
  queryOptions({
    queryKey: keys.invites(gid),
    queryFn: () => api("GET", `${group(gid)}/invites`, { schema: z.array(inviteSchema) }),
  });

export const invitePreviewQuery = (token: string) =>
  queryOptions({
    queryKey: keys.invitePreview(token),
    queryFn: () => api("GET", `/api/v1/invites/${token}`, { schema: invitePreviewSchema }),
    retry: false,
  });

export const expenseQuery = (gid: string, eid: string) =>
  queryOptions({
    queryKey: keys.expense(gid, eid),
    queryFn: () => api("GET", `${group(gid)}/expenses/${eid}`, { schema: expenseSchema }),
    retry: false,
  });

export const settlementsQuery = (gid: string) =>
  queryOptions({
    queryKey: keys.settlements(gid),
    queryFn: () =>
      api("GET", `${group(gid)}/settlements?limit=100`, { schema: pageSchema(settlementSchema) }),
  });

export type ExpenseFilters = Pick<ListExpensesQuery, "q" | "category" | "from" | "to" | "memberId">;

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

export const expensesInfiniteQuery = (gid: string, filters: ExpenseFilters) =>
  infiniteQueryOptions({
    queryKey: keys.expenses(gid, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(
        "GET",
        `${group(gid)}/expenses${queryString({ ...filters, limit: 25, cursor: pageParam })}`,
        {
          schema: pageSchema(expenseSchema),
        },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const activityInfiniteQuery = (gid: string) =>
  infiniteQueryOptions({
    queryKey: keys.activity(gid),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api("GET", `${group(gid)}/activity${queryString({ limit: 30, cursor: pageParam })}`, {
        schema: pageSchema(activityItemSchema),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
