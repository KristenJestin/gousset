import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

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

    return { user: viewer.user };
  },
  component: Outlet,
});
