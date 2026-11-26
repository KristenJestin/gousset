# Gousset: MCP

Gousset serves MCP so that each user can reach their own data from an AI agent (Claude Code, claude.ai, any MCP client). This file records what the protocol and the main client do today, and the rules Gousset's server follows because of it. Every ticket that adds or changes a tool follows it, and the lead reviews every change to the tools against it before merging ([Review of every tool change](#review-of-every-tool-change)).

Adapted from the public MCP reference of the Flottille project (`docs/reference/mcp.md` in its repository), for a web app served over HTTP. Protocol facts checked on 2026-11-22; Claude Code's figures as recorded there in October 2026.

## 1. The protocol

- **Current revision: 2026-07-28**; the previous one is 2025-11-25. The main changes:
  - **Stateless**:
    - the `initialize` handshake and the `Mcp-Session-Id` header are gone;
    - every request carries its protocol version and the client's capabilities in `_meta`;
    - servers must answer `server/discover`;
    - state across calls goes in server-minted handles passed as ordinary tool arguments.
  - **Notifications**:
    - `subscriptions/listen` replaces the HTTP GET stream and `resources/subscribe`;
    - `ping` and `logging/setLevel` are removed.
  - **Multi round-trip requests**: a server that needs more input returns `resultType: "input_required"` instead of sending its own requests (elicitation, sampling, roots). Every result now carries `resultType`.
  - **Tasks** have left the core for an extension (`io.modelcontextprotocol/tasks`).
  - **List caching**: `tools/list` should come in a deterministic order, and list results carry `ttlMs` and `cacheScope`.
  - **Streamable HTTP**:
    - POST requests carry `Mcp-Method` and `Mcp-Name` headers;
    - there is no stream resumability any more: a broken stream means the client re-issues the request.
  - **Deprecated**: Roots, Sampling, Logging, and the old HTTP+SSE transport.
- **Clients speak both revisions**, and many still use 2025-11-25 with `initialize`. Claude Code, for one, has a runtime on TypeScript SDK 1.x (2025-11-25) and one on SDK 2.x (adding 2026-07-28), and still uses the first in many sessions. **Gousset's server accepts both.**
- **The official TypeScript SDK** is `@modelcontextprotocol/server` (2.4.0 on 2026-11-22). It handles both revisions and takes input schemas as Standard Schema. Use the latest 2.x.
- **Authorization** (the 2026-07-28 profile): OAuth 2.1, protected resource metadata (RFC 9728) so a client finds the authorization server from a 401, tokens bound to the resource, and **Client ID Metadata Documents** (CIMD) to identify clients. Dynamic client registration is not required and stays off.

Sources: [changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## 2. What the main client does with a server's tools

Claude Code, the main client, as documented:

| Behaviour | Value |
|---|---|
| Tool search | On by default: MCP tools are **deferred** and found through a search step. `ENABLE_TOOL_SEARCH=false` loads them upfront; `ENABLE_TOOL_SEARCH=auto` (or `auto:N`) loads them upfront while their definitions total under 10 % of the context window (N percent). `_meta["anthropic/alwaysLoad"]: true` on a tool loads that tool upfront. |
| Description cut | 4,096 characters for an upfront tool and for server instructions (2,048 in older versions); 16,384 for a deferred tool. Only the text before the cut is seen. |
| Tool name | the full name `mcp__<server>__<tool>` must stay under 128 characters, or the tool is dropped |
| Text result kept in context | up to 50,000 characters, and 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`, warning at 10,000). Above that, the result is saved to a file and replaced by its path. `_meta["anthropic/maxResultSizeChars"]` on a tool raises its threshold, up to 500,000. |
| Error result (`isError`) | over about 11,000 characters, only the first and last 5,000 are kept |
| `readOnlyHint` | read-only calls run in parallel |
| `idempotentHint` / `readOnlyHint` | a call pending when a connection closed may be repeated once |
| Long calls | a call still running after 2 minutes moves to a background task |
| `_meta["anthropic/requiresUserInteraction"]: true` | shows the tool's permission prompt on every call |

Other clients (claude.ai, other agents) differ in detail; the rules below are written so that a tool reads well in all of them.

## 3. Tool design: what the guidance agrees on

From Anthropic's [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) and the practice around it:

- **Few tools, built for the job**: not one tool per endpoint. Merge steps that always go together, and tools that are near-duplicates, behind an `action` or a detail parameter. Every tool listed costs context on every request (100 to 500 tokens each). Around 15 tools is a comfortable ceiling for one agent. Anthropic's own line for tool search ([Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)) is more than 10 tools or 10,000 tokens of definitions: below both, loading everything upfront is the right call.
- **Names are a namespace**: one name per family, parameters that cannot be misread (`account_id`, not `account`).
- **Descriptions for a new colleague**:
  - say what the tool does and when to use it rather than another tool;
  - say its side effects and when it refuses;
  - put the important part first;
  - a few hundred characters, rarely more than 1,000 (guidance, not a limit to trim to);
  - where an argument is easy to get wrong, one or two valid calls, written in the description (MCP has no field for examples).
- **High-signal results**: names rather than opaque ids, no low-level fields. A concise default with more detail on request. Pagination and limits with defaults, and the way to get the next part written in the result.
- **Errors that say what to do next**, with a valid example, never a trace.
- **Measure**: real tasks in an agent loop. Count calls, tokens and errors, and read the transcripts.

## 4. Rules for Gousset

### The door

1. **One endpoint, `/mcp`, in the app**, over Streamable HTTP, on `@modelcontextprotocol/server`. Both revisions accepted: 2026-07-28 (stateless, `server/discover`) and 2025-11-25 (`initialize`). No protocol session: state across calls lives in Gousset's own handles (cursors, ids).
2. **The administrator can turn the door off** for the whole installation.
3. **The tools call the same packages as the server functions**: no logic of their own in the MCP layer ([`architecture.md`](architecture.md)).

### Authorization and scopes

4. **Every user comes in through OAuth**, from any MCP client, and sees only their own data. better-auth serves the authorization: `@better-auth/mcp` (OAuth 2.1, protected resource metadata, resource-bound tokens) with `@better-auth/cimd` (Client ID Metadata Documents). Dynamic client registration stays off.
5. **Two scopes, chosen on the consent page**: **read**, or **read and write**. A write is refused to a token without the write scope, and the refusal says how to get it.
6. A user sees and revokes their connected clients in their settings. A client's access does not depend on the browser session: a revoke, a password change (the user's own, or the administrator's reset), or a ban cuts it at once, signing out does not.

### Tools

7. **One family tool per concept, with actions**: `accounts` with `list`, `show`…, not one tool per verb. About ten tools in all. The planned families:

   | Family | Arrives in |
   |---|---|
   | `month` | v0.1 (made-up data; since 0.2.1 it says the review is not available yet, with no figure), then v0.4 on the user's own data: `subscriptions` (#34), `benchmarks` (#33), `summary`, `spending` (by category or merchant) and `days` (#32) |
   | `accounts`, `lines`, `imports` | v0.2 |
   | `data` (what an export holds, and where to download it) | v0.2 |
   | `categories`, `merchants`, `rules` (`list`, `show`, `create`, `edit`, `disable`, `delete`, `apply_to_past`) | v0.3 |
   | `review` (`list`, `accept`, `correct`: the lines to review, each with its proposal) | v0.4 |
   | `subjects` | v0.5 |
   | `investments` | v0.6 |

   `merchants` gives `list`, `search`, `show`, `create` (#204: a merchant made by hand, with the labels that name it, its default category, its mark and its colour), `edit` (one change a call: its name, a label moved, its default category, its mark, its subscriptions, and since #204 its colour, labels added, its logo or its logo cleared), `merge` and `assign`. A logo comes as base64 in `edit`'s `logo`: 256 KiB at most, about 350,000 characters, well within the 4 MB a request to the door carries; it is refused, with a valid call, as the logo route refuses it (too large, neither PNG, JPEG nor WebP by its bytes, empty). `show` and `list` say a merchant's colour and whether it has a logo.

   The administration of users (creating one, a ban, a password reset) has no tool: it stays on the users page, an act of the administrator in person. A tool would let an agent holding the administrator's token reset a user's password and sign in with the temporary one before the user does, unattended.

8. **Every tool has a `title`, a description following §3, and annotations**:
   - `readOnlyHint` on reads;
   - `idempotentHint` where a repeat is harmless;
   - `destructiveHint` on writes;
   - `openWorldHint: false`: a tool touches only Gousset's own data.
9. **The tool list comes in a fixed order**, the same for both revisions.
10. **No deprecated feature**: no roots, sampling, logging or elicitation. A tool never asks for input mid-call.

### The budget

Two guards, held by tests, say when the list grows too big to be read well:

- at most **15 tools**;
- at most **44,000 characters** of definitions in the listing (raised from 30,000: about ten tools of up to 4,000 characters each; raised from 40,000 for #32 and #35, confirmed by the maintainer on 2026-11-25);
- every **description under 4,000 characters**, within Claude Code's cut of 4,096 for an upfront tool. An older version cuts at 2,048: the important part comes first, so that what it keeps still says what the tool does, with an example call when an argument is easy to get wrong.

They are not a number to trim to. **A tool keeps the description and the example it needs; a new tool is never paid for by shortening another, and a review refuses such a trim.** When a guard fails, nobody trims: the maintainer decides.

### Results and errors

11. **Text first.** The result's text is what the model reads. Structured content is added only where a client uses it.
12. **Names rather than opaque ids**, and no low-level fields.
13. **Results stay under 20,000 characters** by default. A longer result is paged, and the result writes the next call to make.
14. **Errors stay under 2,000 characters**, say what to do, with a valid example call, and never carry a trace.

### Server instructions

15. **Under 600 words**: what Gousset is, its words (expense, payment, refund, transfer, benefit account, subject, benchmark: see [`vision.md`](vision.md#words)), which tool answers what. A test checks that every tool they name exists.

### Telemetry

16. **Telemetry never sees arguments or results**: a span per call carries only the tool, the action, the duration and the outcome ([`architecture.md`](architecture.md#telemetry)).

## 5. How tools change

### Every feature ticket adds its tools

A feature is reachable from the MCP server in the same pull request that builds it: its family tool and actions, following this file, with end-to-end tests through a real MCP client. The one exception is the administration of users, which has no tool (rule 7, under the planned families).

### Review of every tool change

The lead reviews every change to the tools against this file before merging:

- one family per concept, with actions; no tool per verb;
- `title`, description (what, when, effects, refusals, an example where an argument is easy to get wrong), annotations;
- the guards pass, and no other tool was shortened to make them pass;
- results and errors within their sizes, text first, names rather than ids;
- writes refused without the write scope;
- no logic of its own: the tool calls the packages.

### Measuring

Once per milestone, if the tools changed, the lead runs about ten real tasks through an agent on the made-up data and reads the result: calls, tokens, errors, and the transcripts.
