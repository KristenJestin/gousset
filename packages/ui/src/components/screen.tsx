import type { FormHTMLAttributes, ReactNode } from "react";

/** A screen with one narrow column in its middle: signing in, a first setup, a short page. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">{children}</div>
    </main>
  );
}

/** A form's fields and actions, one under the other. */
export function Form(props: Omit<FormHTMLAttributes<HTMLFormElement>, "className">) {
  return <form {...props} className="flex flex-col gap-4" />;
}

/** A row of actions or links. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}
