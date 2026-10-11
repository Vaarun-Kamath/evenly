import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { UNAUTHENTICATED_EVENT } from "../lib/api";
import { auth } from "../lib/auth";
import { meQuery } from "../lib/queries";
import { useToast } from "../lib/toast";
import { Button } from "./ui";

function Brand() {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-2 rounded-lg text-lg font-semibold tracking-tight"
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg"
      >
        <svg viewBox="0 0 32 32" className="size-4" fill="currentColor">
          <rect x="6" y="8" width="20" height="4" rx="2" />
          <rect x="6" y="14" width="20" height="4" rx="2" />
          <rect x="6" y="20" width="20" height="4" rx="2" />
        </svg>
      </span>
      Evenly
    </Link>
  );
}

function SkipLink() {
  return (
    <a
      href="#content"
      // The page has a <base href> (ADR-0002), so a bare "#content" would resolve against the site root
      // and leave the page. Move focus instead.
      onClick={(event) => {
        event.preventDefault();
        document.getElementById("content")?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
    >
      Skip to content
    </a>
  );
}

/** The layout for signed-in pages: header with navigation, and the page below it. */
export function AppShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const me = useQuery(meQuery);

  // A request that finds the session gone sends the person to sign in again, and back here after.
  useEffect(() => {
    const onUnauthenticated = () => {
      queryClient.clear();
      void navigate({
        to: "/login",
        search: { next: window.location.pathname + window.location.search },
      });
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [navigate, queryClient]);

  const signOut = useMutation({
    mutationFn: () => auth.signOut(),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/login", search: {} });
    },
    onError: () => toast.show("Could not sign out. Please try again.", "error"),
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Brand />
          <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5 text-sm">
            <Link
              to="/"
              className="rounded-lg px-2.5 py-2 hover:bg-surface-2 [&.active]:font-semibold"
              activeOptions={{ exact: true }}
            >
              Groups
            </Link>
            <Link
              to="/account"
              className="min-w-0 max-w-[7rem] truncate rounded-lg px-2.5 py-2 hover:bg-surface-2 sm:max-w-[12rem] [&.active]:font-semibold"
            >
              {me.data?.name ?? "Account"}
            </Link>
            <Button
              variant="ghost"
              className="min-h-9 whitespace-nowrap px-2.5"
              onClick={() => signOut.mutate()}
              loading={signOut.isPending}
            >
              Log out
            </Button>
          </nav>
        </div>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line py-4 text-center text-xs text-muted">
        Evenly is free and open source (AGPL-3.0).
      </footer>
    </div>
  );
}

/** The layout for pages before sign-in: a centred card. */
export function PublicShell({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="mx-auto w-full max-w-md px-4 pt-8">
        <Brand />
      </header>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        {children ?? <Outlet />}
      </main>
      <footer className="py-4 text-center text-xs text-muted">
        Free and open source (AGPL-3.0).
      </footer>
    </div>
  );
}
