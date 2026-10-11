import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell, PublicShell } from "./components/AppShell";
import { AccountPage } from "./features/account/AccountPage";
import { LoginPage, ResetPage, SignupPage } from "./features/auth/AuthPages";
import { EditExpensePage, NewExpensePage } from "./features/expenses/ExpenseFormPage";
import { DashboardPage } from "./features/groups/DashboardPage";
import { GroupPage } from "./features/groups/GroupPage";
import { NewGroupPage } from "./features/groups/NewGroupPage";
import { SettingsPage } from "./features/groups/SettingsPage";
import { InvitePage } from "./features/invite/InvitePage";
import { SettlePage } from "./features/settle/SettlePage";
import { basePath } from "./lib/api";
import { safeNext } from "./lib/auth";
import { meQuery } from "./lib/queries";
import { CrashPage, NotFoundPage } from "./pages";

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => <CrashPage error={error} />,
});

/** Whether there is a signed-in user (without throwing). */
async function signedIn(queryClient: QueryClient): Promise<boolean> {
  try {
    await queryClient.ensureQueryData(meQuery);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- before signing in */

/** Optional search parameters are absent, not `undefined`, so links need not name them. */
const nextSearch = (search: Record<string, unknown>): { next?: string } => {
  const next = safeNext(search.next);
  return next === undefined ? {} : { next };
};

/** Pages for people who are not signed in send signed-in people on to the app. */
async function leaveIfSignedIn(queryClient: QueryClient, next: string | undefined) {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
  if (await signedIn(queryClient)) throw redirect({ to: next ?? "/" });
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: nextSearch,
  beforeLoad: ({ context, search }) => leaveIfSignedIn(context.queryClient, search.next),
  component: () => (
    <PublicShell>
      <LoginPage />
    </PublicShell>
  ),
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  validateSearch: (search: Record<string, unknown>): { next?: string; invite?: string } => ({
    ...nextSearch(search),
    ...(typeof search.invite === "string" && { invite: search.invite }),
  }),
  beforeLoad: ({ context, search }) => leaveIfSignedIn(context.queryClient, search.next),
  component: () => (
    <PublicShell>
      <SignupPage />
    </PublicShell>
  ),
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset",
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === "string" ? { token: search.token } : {},
  component: () => (
    <PublicShell>
      <ResetPage />
    </PublicShell>
  ),
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: () => (
    <PublicShell>
      <InvitePage />
    </PublicShell>
  ),
});

/* -------------------------------------------------------- after signing in */

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ context, location }) => {
    if (!(await signedIn(context.queryClient))) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
      throw redirect({ to: "/login", search: { next: location.href } });
    }
  },
  component: AppShell,
});

const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  component: DashboardPage,
});
const newGroupRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/groups/new",
  component: NewGroupPage,
});
const groupRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/g/$gid",
  validateSearch: (search: Record<string, unknown>): { tab?: "activity" } =>
    search.tab === "activity" ? { tab: "activity" } : {},
  component: GroupPage,
});
const newExpenseRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/g/$gid/expenses/new",
  component: NewExpensePage,
});
const editExpenseRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/g/$gid/expenses/$eid",
  component: EditExpensePage,
});
const settleRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/g/$gid/settle",
  component: SettlePage,
});
const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/g/$gid/settings",
  component: SettingsPage,
});
const accountRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/account",
  component: AccountPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  resetRoute,
  inviteRoute,
  authedRoute.addChildren([
    dashboardRoute,
    newGroupRoute,
    groupRoute,
    newExpenseRoute,
    editExpenseRoute,
    settleRoute,
    settingsRoute,
    accountRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    // The server injects the runtime base path into index.html (ADR-0002, ADR-0005).
    basepath: basePath === "" ? "/" : basePath,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
