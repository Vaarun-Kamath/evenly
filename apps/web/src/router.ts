import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { basePath } from "./lib/api";
import { Home, Layout, Status } from "./pages";

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status",
  component: Status,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, statusRoute]),
  basepath: basePath === "" ? "/" : basePath,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
