/**
 * A short confirmation that an action succeeded ("Robin can now sign in"), announced to screen
 * readers. Its live region is always there, empty without a message, and only its text changes:
 * a region inserted together with its text is often not announced. Toasts come with the shared
 * components (#7).
 */
export function StatusMessage({ message }: { message: string | undefined }) {
  return (
    <p role="status" className="text-foreground text-sm empty:hidden">
      {message}
    </p>
  );
}
