import type { ReactNode } from "react";

/** A list of people or things, one per row. */
export function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y">
      {children}
    </ul>
  );
}

/** One row of a `List`: its name, a second line, and short tags. */
export function ListItem({
  title,
  description,
  tags = [],
}: {
  title: string;
  description?: string;
  tags?: Array<string>;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-foreground truncate text-sm font-medium">{title}</span>
        {description === undefined ? null : (
          <span className="text-muted-foreground truncate text-sm">{description}</span>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {tags.map((tag) => (
          <span key={tag} className="bg-muted text-foreground rounded-md px-2 py-0.5 text-xs">
            {tag}
          </span>
        ))}
      </div>
    </li>
  );
}
