import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import { Frame } from "@/components/frame";

/** Every page but sign-in (and the first setup) requires a session. */
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context, location }) => {
    const { viewer } = context;

    if (!viewer.hasUsers) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/setup" });
    }

    if (!viewer.user) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/sign-in" });
    }

    // A temporary password is changed before anything else.
    if (viewer.user.mustChangePassword && location.pathname !== "/change-password") {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/change-password" });
    }

    return { user: viewer.user, currentMonth: viewer.currentMonth };
  },
  component: Authed,
});

function Authed() {
  const { user } = Route.useRouteContext();
  const { pathname } = useLocation();

  // A temporary password is changed alone on its page, before the app opens; an MCP client's
  // consent stands alone too, a stop on the way back to that client rather than a screen of the app.
  if (user.mustChangePassword || pathname === "/consent") {
    return <Outlet />;
  }

  return (
    <Frame user={user}>
      <Outlet />
    </Frame>
  );
}
