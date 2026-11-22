import { Block, ErrorState, FadeIn } from "@gousset/ui/components/data-block";
import type { BlockProps } from "@gousset/ui/components/data-block";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Component, Suspense } from "react";
import type { ReactNode } from "react";

type BoundaryProps = {
  fallback: (retry: () => void) => ReactNode;
  onReset: () => void;
  children: ReactNode;
};

/** Keeps a block's error inside the block. React catches render errors only in a class. */
class BlockBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
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
 * shaped exactly like its content; if it fails, the block alone says so and offers to try again.
 * The rest of its props are `Block`'s.
 */
export function DataBlock({
  skeleton,
  children,
  ...block
}: Omit<BlockProps, "children"> & { skeleton: ReactNode; children: ReactNode }) {
  const { reset } = useQueryErrorResetBoundary();

  return (
    <Block {...block}>
      <BlockBoundary onReset={reset} fallback={(retry) => <ErrorState onRetry={retry} />}>
        <Suspense fallback={skeleton}>
          <FadeIn>{children}</FadeIn>
        </Suspense>
      </BlockBoundary>
    </Block>
  );
}
