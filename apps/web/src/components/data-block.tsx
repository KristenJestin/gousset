import { Block, ErrorState, FadeIn } from "@gousset/ui/components/data-block";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Component, Suspense } from "react";
import type { ReactNode } from "react";

type BoundaryProps = {
  fallback: (retry: () => void) => ReactNode;
  onReset: () => void;
  /** What the block shows (its month): when it changes, a past failure no longer applies. */
  resetKey: string;
  children: ReactNode;
};

type BoundaryState = { failed: boolean; resetKey: string };

/** Keeps a block's error inside the block. React catches render errors only in a class. */
class BlockBoundary extends Component<BoundaryProps, BoundaryState> {
  override state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Another month: try again rather than keep the last month's error.
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  retry = () => {
    this.props.onReset();
    this.setState({ failed: false });
  };

  override render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

/**
 * One block of a page that loads on its own (docs/architecture.md, "Data loading and skeletons"):
 * its content reads its query with `useSuspenseQuery`; while it waits, the block shows `skeleton`,
 * shaped exactly like its content; if it fails, the block alone says so and offers to try again,
 * until it shows something else (`resetKey`).
 */
export function DataBlock({
  title,
  skeleton,
  resetKey,
  children,
}: {
  title: string;
  skeleton: ReactNode;
  resetKey: string;
  children: ReactNode;
}) {
  const { reset } = useQueryErrorResetBoundary();

  return (
    <Block title={title}>
      <BlockBoundary
        onReset={reset}
        resetKey={resetKey}
        fallback={(retry) => <ErrorState onRetry={retry} />}
      >
        <Suspense fallback={skeleton}>
          <FadeIn>{children}</FadeIn>
        </Suspense>
      </BlockBoundary>
    </Block>
  );
}
