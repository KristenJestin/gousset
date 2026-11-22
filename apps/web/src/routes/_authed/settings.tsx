import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { List, ListItem } from "@gousset/ui/components/list";
import { Actions, Screen } from "@gousset/ui/components/screen";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AppLink } from "@/components/app-link";
import {
  getConnectedClients,
  getMcpDoor,
  revokeConnectedClient,
  setMcpDoor,
} from "@/functions/mcp";
import { errorMessage } from "@/i18n/messages";
import { useMessages } from "@/i18n/use-messages";
import { refusalOf } from "@/lib/refusal";
import { whileBusy } from "@/lib/while-busy";

/** A user's settings: the MCP clients they allowed; for the administrator, the MCP door itself. */
export const Route = createFileRoute("/_authed/settings")({
  loader: async () => {
    const [clients, door] = await Promise.all([getConnectedClients(), getMcpDoor()]);

    return { clients, door };
  },
  component: Settings,
});

function Settings() {
  const messages = useMessages();
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
      setClientsError(errorMessage(messages, refusal));

      return;
    }

    setClientsError(undefined);
    setRevoked(messages.settings.revoked(name));
    await router.invalidate();
  }

  async function turn(open: boolean) {
    const refusal = await whileBusy(setBusy, () => refusalOf(() => setMcpDoor({ data: { open } })));

    if (refusal !== undefined) {
      setDoorError(errorMessage(messages, refusal));

      return;
    }

    setDoorError(undefined);
    await router.invalidate();
  }

  const doorState = door.servable
    ? door.open
      ? messages.settings.doorOpen
      : messages.settings.doorClosed
    : messages.settings.doorUnavailable;

  return (
    <Screen>
      <Card
        title={messages.settings.clientsTitle}
        description={messages.settings.clientsDescription(door.endpoint)}
      >
        {clients.length === 0 ? (
          <StatusMessage message={messages.settings.noClients} />
        ) : (
          <List label={messages.settings.clientsTitle}>
            {clients.map((client) => (
              <ListItem
                key={client.clientId}
                title={client.name}
                description={
                  client.host === null ? undefined : messages.settings.clientFrom(client.host)
                }
                tags={[client.canWrite ? messages.settings.readWrite : messages.settings.readOnly]}
                action={
                  <Button
                    variant="secondary"
                    loading={busy}
                    aria-label={messages.settings.revokeLabel(client.name)}
                    onClick={() => void revoke(client.clientId, client.name)}
                  >
                    {messages.settings.revoke}
                  </Button>
                }
              />
            ))}
          </List>
        )}
        <StatusMessage message={revoked} />
        <FormMessage message={clientsError} />
      </Card>
      {door.canManage ? (
        <Card title={messages.settings.doorTitle} description={doorState}>
          {door.servable ? (
            <Actions>
              <Button variant="secondary" loading={busy} onClick={() => void turn(!door.open)}>
                {door.open ? messages.settings.turnOff : messages.settings.turnOn}
              </Button>
            </Actions>
          ) : null}
          <FormMessage message={doorError} />
        </Card>
      ) : null}
      <Actions>
        <AppLink to="/">{messages.settings.back}</AppLink>
      </Actions>
    </Screen>
  );
}
