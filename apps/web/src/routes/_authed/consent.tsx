import { MCP_SCOPES, McpScope } from "@gousset/auth/mcp";
import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { Actions, Screen } from "@gousset/ui/components/screen";
import { useHydrated } from "@gousset/ui/hooks/use-hydrated";
import { createFileRoute } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import { useState } from "react";

import { getConsentClient } from "@/functions/mcp";
import { errorMessage } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { whileBusy } from "@/lib/while-busy";

/**
 * The page an MCP client's authorization stops at (docs/mcp.md, "Authorization and scopes"): the
 * user allows it to read, or to read and write, or denies it. The signed authorization request
 * stays in the address; the auth client sends it back with the answer.
 */
const ConsentSearch = Schema.Struct({
  client_id: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  redirect_uri: Schema.optional(Schema.String),
});

/** The host a redirect sends the browser to, as the user should read it. */
const hostOf = (uri: string | undefined) =>
  uri !== undefined && URL.canParse(uri) ? new URL(uri).host : undefined;

/**
 * Where better-auth sends the browser once the user answered: back to the client. Its auth client
 * follows it by itself (`redirect` and `url` in the answer); the page only checks it came.
 */
const ConsentAnswer = Schema.Struct({ url: Schema.String });

const answerOf = Schema.decodeUnknownOption(ConsentAnswer);

export const Route = createFileRoute("/_authed/consent")({
  validateSearch: Schema.toStandardSchemaV1(ConsentSearch),
  loaderDeps: ({ search }) => ({ clientId: search.client_id ?? "" }),
  loader: ({ deps }) => getConsentClient({ data: { clientId: deps.clientId } }),
  component: Consent,
});

function Consent() {
  const client = Route.useLoaderData();
  const { scope = "", redirect_uri: redirectUri } = Route.useSearch();
  const back = hostOf(redirectUri);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // The page comes from the server, reached by a full load: until it hydrates, a click on an answer
  // does nothing and is lost, so no answer is offered before it works (#97).
  const ready = useHydrated();
  const requested = scope.split(" ").filter((part) => part !== "");
  const asksWrite = requested.includes(McpScope.write);

  async function answer(accept: boolean, granted: ReadonlyArray<string>) {
    const { data, error: refusal } = await whileBusy(setBusy, () =>
      authClient.$fetch("/oauth2/consent", {
        method: "POST",
        body: { accept, scope: granted.join(" ") },
      }),
    );

    const next = answerOf(data);

    if (refusal || Option.isNone(next)) {
      setError(errorMessage(undefined));
    }
  }

  // Read only keeps what was asked but the write scope (the server adds read to a request for
  // write, so read is always there to keep); read and write keeps it all.
  const readOnly = requested.filter((part) => part !== McpScope.write);
  const everything = requested.length > 0 ? requested : [...MCP_SCOPES];

  // Who really asks: the name is the client's own words, the hosts are not.
  const origin =
    back === undefined
      ? undefined
      : client?.host === null || client?.host === undefined
        ? m.consentUnknownOrigin({ back })
        : m.consentOrigin({ client: client.host, back });

  const description = [
    origin,
    m.consentDescription(),
    asksWrite ? m.consentWriteDescription() : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" ");

  return (
    <Screen>
      <Card
        title={m.consentTitle({ client: client?.name ?? m.consentUnknownClient() })}
        description={description}
      >
        <FormMessage message={error} />
        <Actions>
          {asksWrite ? (
            <>
              <Button loading={busy} disabled={!ready} onClick={() => void answer(true, readOnly)}>
                {m.consentAllowRead()}
              </Button>
              <Button
                variant="secondary"
                loading={busy}
                disabled={!ready}
                onClick={() => void answer(true, everything)}
              >
                {m.consentAllowReadWrite()}
              </Button>
            </>
          ) : (
            <Button loading={busy} disabled={!ready} onClick={() => void answer(true, everything)}>
              {m.consentAllow()}
            </Button>
          )}
          <Button
            variant="secondary"
            loading={busy}
            disabled={!ready}
            onClick={() => void answer(false, [])}
          >
            {m.consentDeny()}
          </Button>
        </Actions>
      </Card>
    </Screen>
  );
}
