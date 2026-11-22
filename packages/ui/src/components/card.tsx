import type { ReactNode } from "react";

/** A block on the page: a title, a line saying what it is for, then its content. */
export function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-card text-card-foreground flex w-full flex-col gap-6 rounded-xl border p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold">{title}</h1>
        {description === undefined ? null : (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}
