import { useSyncExternalStore } from "react";

import { notify, toastStore } from "../lib/notify-stand-in";
import { Button } from "./button";

const texts = {
  en: {
    region: "Notifications",
    failed: "Something went wrong",
    retry: "Retry",
    dismiss: "Dismiss",
  },
  fr: {
    region: "Notifications",
    failed: "Un problème est survenu",
    retry: "Réessayer",
    dismiss: "Fermer",
  },
};

const subscribeToNothing = () => () => {};

/**
 * TODO(#7): replaced by `Toaster` (`./toaster`), mounted the same way, once per page. Where the
 * toasts `notify` sends show: an error stays until dismissed and is announced at once. Its texts
 * follow the page's language (`<html lang>`).
 */
export function Toaster() {
  const shown = useSyncExternalStore(toastStore.subscribe, toastStore.current, toastStore.none);

  const language = useSyncExternalStore(
    subscribeToNothing,
    () => document.documentElement.lang,
    () => "en",
  );

  const words = language.startsWith("fr") ? texts.fr : texts.en;

  return (
    <section aria-label={words.region} className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {shown.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="bg-popover text-popover-foreground flex items-center gap-3 rounded-lg border p-4 text-sm shadow-md"
        >
          <div className="flex flex-col gap-1">
            <span className="font-medium">{words.failed}</span>
            {toast.description === undefined ? null : <span>{toast.description}</span>}
          </div>
          {toast.retry === undefined ? null : (
            <Button
              variant="secondary"
              onClick={() => {
                notify.dismiss(toast.id);
                toast.retry?.();
              }}
            >
              {words.retry}
            </Button>
          )}
          <Button variant="secondary" onClick={() => notify.dismiss(toast.id)}>
            {words.dismiss}
          </Button>
        </div>
      ))}
    </section>
  );
}
