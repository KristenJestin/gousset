import { m } from "@gousset/i18n/messages";
import { Block } from "@gousset/ui/components/app-shell";
import { TextLink } from "@gousset/ui/components/text-link";
import { createFileRoute } from "@tanstack/react-router";

/**
 * The user's data (#22): the export of everything they keep, one archive downloaded from
 * `/api/export`. The browser downloads it as it does any file, with its own progress; nothing on
 * the page moves.
 */
export const Route = createFileRoute("/_authed/settings/data")({
  component: DataSettings,
});

function DataSettings() {
  return (
    <Block title={m.exportTitle()} description={m.exportDescription()}>
      <TextLink href="/api/export" download>
        {m.exportDownload()}
      </TextLink>
    </Block>
  );
}
