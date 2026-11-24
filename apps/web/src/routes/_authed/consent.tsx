import { MCP_SCOPES, McpScope } from "@gousset/auth/mcp";
import { m } from "@gousset/i18n/messages";
import { ConsentScreen } from "@gousset/ui/components/consent-screen";
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

/** The choice pressed, while its answer is sent. */
type Pressed = "read" | "everything" | "deny";

function Consent() {
  const client = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const { scope = "", redirect_uri: redirectUri } = Route.useSearch();
  const back = hostOf(redirectUri);
  const [error, setError] = useState<string>();
  const [pressed, setPressed] = useState<Pressed>();
  const requested = scope.split(" ").filter((part) => part !== "");
  const asksWrite = requested.includes(McpScope.write);

  async function answer(choice: Pressed, accept: boolean, granted: ReadonlyArray<string>) {
    const { data, error: refusal } = await whileBusy(
      (busy) => setPressed(busy ? choice : undefined),
      () =>
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

  // Where the connected clients are revoked, as the settings name it.
  const place = [m.settingsTitle(), m.settingsNavGeneral(), m.mcpClientsTitle()].join(" › ");

  // Read only first, the primary and recommended choice: the safer one is the easy one.
  const allow = asksWrite
    ? [
        {
          label: m.consentAllowRead(),
          recommended: m.consentRecommended(),
          loading: pressed === "read",
          onClick: () => void answer("read", true, readOnly),
        },
        {
          label: m.consentAllowReadWrite(),
          loading: pressed === "everything",
          onClick: () => void answer("everything", true, everything),
        },
      ]
    : [
        {
          label: m.consentAllow(),
          loading: pressed === "everything",
          onClick: () => void answer("everything", true, everything),
        },
      ];

  return (
    <ConsentScreen
      brandLabel={m.appName()}
      title={m.consentTitle({ client: client?.name ?? m.consentUnknownClient() })}
      origin={origin}
      readsTitle={m.consentReadsTitle()}
      reads={[
        { icon: "accounts", label: m.consentReadsAccounts() },
        { icon: "operations", label: m.consentReadsLines() },
        { icon: "review", label: m.consentReadsMonths() },
      ]}
      write={
        asksWrite
          ? {
              title: m.consentWriteTitle(),
              summary: m.consentWriteSummary(),
              detail: m.consentWriteDetail(),
            }
          : undefined
      }
      revoke={m.consentRevoke({ place })}
      error={error}
      busy={pressed !== undefined}
      allow={allow}
      deny={{
        label: m.consentDeny(),
        loading: pressed === "deny",
        onClick: () => void answer("deny", false, []),
      }}
      signedIn={m.consentSignedInAs({ email: user.email })}
    />
  );
}
