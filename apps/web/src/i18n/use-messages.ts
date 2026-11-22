import { useRouteContext } from "@tanstack/react-router";

import { messagesFor } from "./messages";

/** The interface's texts in the viewer's language. */
export function useMessages() {
  const locale = useRouteContext({ from: "__root__", select: (context) => context.viewer.locale });

  return messagesFor(locale);
}
