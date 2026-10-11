import { pingResponseSchema } from "@evenly/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { apiGet, basePath } from "./lib/api";

export function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-10">
      <header className="flex items-baseline justify-between">
        <Link to="/" className="text-xl font-semibold tracking-tight">
          Evenly
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link to="/" className="underline-offset-4 hover:underline [&.active]:font-semibold">
            Home
          </Link>
          <Link
            to="/status"
            className="underline-offset-4 hover:underline [&.active]:font-semibold"
          >
            Status
          </Link>
        </nav>
      </header>
      <main className="mt-10 flex-1">
        <Outlet />
      </main>
      <footer className="mt-10 text-xs text-neutral-500">Free and open source, AGPL-3.0.</footer>
    </div>
  );
}

export function Home() {
  return (
    <section className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">Split expenses, evenly.</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Hello from Evenly. The app itself is on its way; this page proves the skeleton works.
      </p>
    </section>
  );
}

export function Status() {
  const ping = useQuery({
    queryKey: ["ping"],
    queryFn: () => apiGet("/ping", pingResponseSchema),
  });

  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Base path</dt>
        <dd className="font-mono">{basePath === "" ? "/" : basePath}</dd>
        <dt className="text-neutral-500">API</dt>
        <dd role="status">
          {ping.isPending && "Checking…"}
          {ping.isError && `Unreachable: ${ping.error.message}`}
          {ping.isSuccess && `OK (${ping.data.name})`}
        </dd>
      </dl>
    </section>
  );
}
