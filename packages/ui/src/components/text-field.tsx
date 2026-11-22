import { useId } from "react";
import type { InputHTMLAttributes } from "react";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> & {
  label: string;
};

/** A labelled text input: names, e-mails, passwords. */
export function TextField({ label, ...props }: TextFieldProps) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-foreground text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="border-input bg-background text-foreground focus-visible:ring-ring h-9 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
      />
    </div>
  );
}
