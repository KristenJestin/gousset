import { m } from "@gousset/i18n/messages";
import { getLocale, locales, setLocale } from "@gousset/i18n/runtime";
import type { Locale } from "@gousset/i18n/runtime";
import { Block } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { ColorSchemePicker } from "@gousset/ui/components/color-scheme-picker";
import { FormMessage } from "@gousset/ui/components/form-message";
import { List, ListItem } from "@gousset/ui/components/list";
import { Actions } from "@gousset/ui/components/screen";
import { SegmentedChoice } from "@gousset/ui/components/segmented-choice";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { Switch } from "@gousset/ui/components/switch";
import { useFormatForDisplay } from "@tanstack/react-hotkeys";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  getConnectedClients,
  getMcpDoor,
  revokeConnectedClient,
  setMcpDoor,
} from "@/functions/mcp";
import { setSingleKeyShortcuts } from "@/functions/shortcuts";
import { errorMessage } from "@/i18n/messages";
import { refusalOf } from "@/lib/refusal";
import { whileBusy } from "@/lib/while-busy";

/** Each language, in its own words: the same in every language. */
const LANGUAGE_NAMES = {
  en: m.languageEnglish,
  fr: m.languageFrench,
} satisfies { [locale in Locale]: () => string };

/**
 * The general settings: how the interface looks and speaks, the MCP clients the user allowed and,
 * for the administrator, the MCP door itself. The blocks to come land here, one under the other:
 * the colour scheme kept on the account (#50).
 */
export const Route = createFileRoute("/_authed/settings/")({
  loader: async () => {
    const [clients, door] = await Promise.all([getConnectedClients(), getMcpDoor()]);

    return { clients, door };
  },
  component: GeneralSettings,
});

function GeneralSettings() {
  return (
    <>
      <Block title={m.settingsLanguageTitle()} description={m.settingsLanguageDescription()}>
        <SegmentedChoice
          label={m.settingsLanguageTitle()}
          value={getLocale()}
          choices={locales.map((locale) => ({ value: locale, label: LANGUAGE_NAMES[locale]() }))}
          onChange={(locale) => void setLocale(locale)}
        />
      </Block>
      <Block title={m.settingsColorSchemeTitle()} description={m.settingsColorSchemeDescription()}>
        <ColorSchemePicker
          label={m.settingsColorSchemeTitle()}
          choices={{
            system: m.colorSchemeSystem(),
            light: m.colorSchemeLight(),
            dark: m.colorSchemeDark(),
          }}
        />
      </Block>
      <ShortcutSettings />
      <McpSettings />
    </>
  );
}

/**
 * Turns the single-key shortcuts off or on again (WCAG 2.2, 2.1.4 Character Key Shortcuts), kept
 * on the account. The switch moves at once and shows the value being saved; one save at a time,
 * so that two quick toggles cannot land out of order. Otherwise it shows what the account holds:
 * a refusal puts it back to that, and says so.
 */
function ShortcutSettings() {
  const router = useRouter();
  const { user } = Route.useRouteContext();
  const formatForDisplay = useFormatForDisplay();
  const [saving, setSaving] = useState<boolean>();
  const [error, setError] = useState<string>();

  async function turn(next: boolean) {
    if (saving !== undefined) {
      return;
    }

    setSaving(next);

    const refusal = await refusalOf(() => setSingleKeyShortcuts({ data: { on: next } }));

    setError(refusal === undefined ? undefined : errorMessage(refusal));

    if (refusal === undefined) {
      // The root reads the setting again: the shortcuts, and this switch, follow it.
      await router.invalidate();
    }

    setSaving(undefined);
  }

  return (
    <Block title={m.settingsShortcutsTitle()}>
      <Switch
        label={m.settingsSingleKeyShortcuts()}
        description={m.settingsSingleKeyShortcutsDescription({ keys: formatForDisplay("Mod+/") })}
        checked={saving ?? user.singleKeyShortcuts}
        onCheckedChange={(next) => void turn(next)}
      />
      <FormMessage message={error} />
    </Block>
  );
}

function McpSettings() {
  const router = useRouter();
  const { clients, door } = Route.useLoaderData();
  const [revoked, setRevoked] = useState<string>();
  const [clientsError, setClientsError] = useState<string>();
  const [doorError, setDoorError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function revoke(clientId: string, name: string) {
    const refusal = await whileBusy(setBusy, () =>
      refusalOf(() => revokeConnectedClient({ data: { clientId } })),
    );

    // A failure says so, and the page stays as it is, the client listed: never a silent
    // "revoked", and no reload that would take the message away.
    if (refusal !== undefined) {
      setRevoked(undefined);
      setClientsError(errorMessage(refusal));

      return;
    }

    setClientsError(undefined);
    setRevoked(m.mcpRevoked({ client: name }));
    await router.invalidate();
  }

  async function turn(open: boolean) {
    const refusal = await whileBusy(setBusy, () => refusalOf(() => setMcpDoor({ data: { open } })));

    if (refusal !== undefined) {
      setDoorError(errorMessage(refusal));

      return;
    }

    setDoorError(undefined);
    await router.invalidate();
  }

  const doorState = door.servable
    ? door.open
      ? m.mcpDoorOpen()
      : m.mcpDoorClosed()
    : m.mcpDoorUnavailable();

  return (
    <>
      <Block
        title={m.mcpClientsTitle()}
        description={m.mcpClientsDescription({ endpoint: door.endpoint })}
      >
        {clients.length === 0 ? (
          <StatusMessage message={m.mcpNoClients()} />
        ) : (
          <List label={m.mcpClientsTitle()}>
            {clients.map((client) => (
              <ListItem
                key={client.clientId}
                title={client.name}
                description={
                  client.host === null ? undefined : m.mcpClientFrom({ host: client.host })
                }
                tags={[client.canWrite ? m.mcpReadWrite() : m.mcpReadOnly()]}
                action={
                  <Button
                    variant="secondary"
                    loading={busy}
                    aria-label={m.mcpRevokeLabel({ client: client.name })}
                    onClick={() => void revoke(client.clientId, client.name)}
                  >
                    {m.mcpRevoke()}
                  </Button>
                }
              />
            ))}
          </List>
        )}
        <StatusMessage message={revoked} />
        <FormMessage message={clientsError} />
      </Block>
      {door.canManage ? (
        <Block title={m.mcpDoorTitle()} description={doorState}>
          {door.servable ? (
            <Actions>
              <Button variant="secondary" loading={busy} onClick={() => void turn(!door.open)}>
                {door.open ? m.mcpTurnOff() : m.mcpTurnOn()}
              </Button>
            </Actions>
          ) : null}
          <FormMessage message={doorError} />
        </Block>
      ) : null}
    </>
  );
}
