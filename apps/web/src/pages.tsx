import { Link } from "@tanstack/react-router";
import { PublicShell } from "./components/AppShell";
import { Card, LinkButton } from "./components/ui";

/** Shown for any address the app does not know. */
export function NotFoundPage() {
  return (
    <PublicShell>
      <Card as="section" className="flex flex-col items-start gap-4 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted">That address does not lead anywhere in Evenly.</p>
        <LinkButton to="/">Go to your groups</LinkButton>
      </Card>
    </PublicShell>
  );
}

/** Shown when a page crashes: a way out, and what happened. */
export function CrashPage({ error }: { error: unknown }) {
  return (
    <PublicShell>
      <Card as="section" className="flex flex-col items-start gap-4 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted">
          {error instanceof Error ? error.message : "An unexpected error stopped this page."}
        </p>
        <button
          type="button"
          className="rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-fg"
          onClick={() => window.location.reload()}
        >
          Reload the page
        </button>
        <Link to="/" className="text-sm underline underline-offset-4">
          Go to your groups
        </Link>
      </Card>
    </PublicShell>
  );
}
