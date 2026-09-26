# MCP messages as they appear in a log

Read this in steps 2 and 3 when a message in the log needs interpreting: which request a response belongs to, what a
result field means, and what changed between protocol revisions. Facts are from the MCP specification, revision
2026-07-28 (the current revision on 2026-09-26, per [Versioning](https://modelcontextprotocol.io/specification/versioning)),
with the earlier revisions noted where logs from older servers look different. Schema links point at the tagged
release of each revision.

## JSON-RPC underneath

Every MCP message is a JSON-RPC 2.0 message
([MCP basic protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic)).

| Message | How to recognise it | Rule that matters for an audit | Source |
| --- | --- | --- | --- |
| Request | `method` and `id` | The `id` is a string or integer, never `null`, and is not reused while an earlier request with that `id` is unanswered | [MCP basic](https://modelcontextprotocol.io/specification/2026-07-28/basic) |
| Result response | `id` and `result` | Same `id` as the request. Since 2026-07-28 every result has `resultType`; a result without it (older servers) counts as `"complete"` | [MCP basic](https://modelcontextprotocol.io/specification/2026-07-28/basic), [schema L208-L236](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L208-L236) |
| Error response | `id` and `error` with `code` and `message` | Same `id` as the request, except when the request could not be read | [MCP basic](https://modelcontextprotocol.io/specification/2026-07-28/basic) |
| Notification | `method`, no `id` | Never answered | [JSON-RPC 2.0, section 4.1](https://www.jsonrpc.org/specification) |
| Batch | a JSON array of messages | Responses may come back in any order; match them by `id`. MCP allowed batches only in 2025-03-26: added there, removed in 2025-06-18 | [JSON-RPC 2.0, section 6](https://www.jsonrpc.org/specification), [2025-03-26 changelog](https://modelcontextprotocol.io/specification/2025-03-26/changelog), [2025-06-18 changelog](https://modelcontextprotocol.io/specification/2025-06-18/changelog) |

Each side numbers its own requests, so two servers (or a server and the client) can use the same `id` at the same
time. Pair requests and responses per server connection, never across the whole log. `scripts/tool-call-table.mjs`
keys pending requests by file, server label and session, and warns about reused and unmatched ids.

## Which revision, which server

| Question | 2026-07-28 | 2025-11-25 and earlier | Source |
| --- | --- | --- | --- |
| Protocol version | `_meta["io.modelcontextprotocol/protocolVersion"]` on every request; `MCP-Protocol-Version` header on HTTP | `protocolVersion` in the `initialize` request and result (the handshake) | [MCP basic](https://modelcontextprotocol.io/specification/2026-07-28/basic), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) |
| Server identity | `_meta["io.modelcontextprotocol/serverInfo"]` in results (servers SHOULD send it), and `server/discover` | `serverInfo` in the `initialize` result | [MCP basic](https://modelcontextprotocol.io/specification/2026-07-28/basic), [2025-11-25 schema L277-L291](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L277-L291) |
| Server instructions | `instructions` in the `server/discover` result | `instructions` in the `initialize` result | [2026-07-28 schema L670-L697](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L670-L697), [2025-11-25 schema L277-L291](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L277-L291) |
| Sessions | None: every request stands alone | `Mcp-Session-Id` on Streamable HTTP | [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) |

Two cautions for the audit:

- `clientInfo` and `serverInfo` are self-reported and not verified by the protocol, and the specification says not to
  rely on them for security decisions ([MCP basic](https://modelcontextprotocol.io/specification/2026-07-28/basic)).
  Identify a server by how the host connected to it (the command it launched or the URL it called), and use the
  reported name only as a label.
- Server `instructions` go to the model: the schema says they "MAY be added to the system prompt"
  ([2025-11-25 schema L277-L291](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L277-L291);
  the 2026-07-28 `DiscoverResult` says clients can include them in a system prompt,
  [schema L670-L697](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L670-L697)).
  Read them the same way as tool output (`injected-instructions.md`).

## The tool list

A `tools/list` result holds `tools`, each with `name`, optional `title`, `description`, `inputSchema`, optional
`outputSchema`, optional `annotations`, optional `icons` and `_meta`; results can be paginated with `nextCursor`, and
since 2026-07-28 carry `ttlMs` and `cacheScope`
([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
[schema L1973-L2015](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L1973-L2015),
[2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).

- The list can change during a session. A server that declared `listChanged` sends
  `notifications/tools/list_changed`; in 2026-07-28 it arrives on a `subscriptions/listen` stream
  ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). Use the definition the client had
  when it made the call, and compare it with earlier definitions of the same tool.
- In 2026-07-28 the list must not vary per connection but may vary by the authorization on the request, "for example,
  returning only the tools the caller's granted scopes permit"
  ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- Tool names are unique only within one server. Clients that combine several servers may see collisions and should
  prefix names with a server identifier ([Tools, Tool Names](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
  When two servers offer the same name, find out from the host which one ran.
- A parameter whose schema has `x-mcp-header` is copied into an `Mcp-Param-{name}` HTTP header on Streamable HTTP,
  where proxies can see and log it; servers should not mark passwords, keys, tokens or personal data this way
  ([Tools, x-mcp-header](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

## A tool call and its result

Request: `method: "tools/call"`, `params.name`, `params.arguments` (an object), optional `params._meta`, and on a
multi round-trip retry `params.inputResponses` and `params.requestState`
([schema L1852-L1872](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L1852-L1872)).

Result (`CallToolResult`,
[schema L1795-L1838](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L1795-L1838)):

- `content`: a list of `text`, `image`, `audio`, `resource_link` and embedded `resource` items. Resource links point
  at data the client may fetch later; embedded resources carry the data itself
  ([Tools, Tool Result](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- `structuredContent`: any JSON value, checked against the tool's `outputSchema` when it has one. Servers should repeat
  it as text for older clients ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- `isError`: `true` when the tool ran and failed. When absent, the call counts as successful.

There are two kinds of error ([Tools, Error Handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)):

| Kind | Shape | Examples | What it tells the audit |
| --- | --- | --- | --- |
| Protocol error | JSON-RPC `error` response | Unknown tool (`-32602`), malformed request, server error | The tool most likely did not run. An unknown tool can mean the agent invented a name |
| Tool execution error | `result` with `isError: true` | API failure, input validation error, business rule | The tool ran. Part of the work may be done; the error text goes back to the model |

Since 2025-11-25, input validation errors are tool execution errors, so the model can correct itself
([2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)). Clients should give tool
execution errors to the model ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)), which
makes error text another way for a server's words to reach the model.

Error codes in the MCP-reserved range: `-32020` header mismatch, `-32021` missing required client capability, `-32022`
unsupported protocol version. `-32002` (resource not found) and `-32042` (URL elicitation required) belong to
2025-11-25 and earlier ([MCP basic, Error Codes](https://modelcontextprotocol.io/specification/2026-07-28/basic)).

## Multi round-trip requests (2026-07-28)

A server that needs more input answers `tools/call` with `resultType: "input_required"`, an `inputRequests` map
(each value an `elicitation/create`, `sampling/createMessage` or `roots/list` request) and an opaque `requestState`.
The client then retries the original request with a new `id`, the same parameters, `inputResponses` keyed like
`inputRequests`, and the exact `requestState`
([Multi round-trip requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr),
[schema L571-L595](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L571-L595)).

- A server may answer `input_required` more than once for the same request.
- Servers must treat `requestState` as input an attacker controls, protect its integrity when it influences
  authorization or business logic, and should bind it to the user, a short expiry and the original request. Where a
  `requestState` must be used at most once, the server must enforce that itself
  ([Multi round-trip requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)). Two
  completed retries with the same `requestState` are therefore worth a finding.
- In an audit, the first attempt (`input_required`) and its retry are one logical call. The `inputResponses` carry what
  the user answered, which is personal data when the form asked for it.

Before 2026-07-28 the server sent these as its own requests to the client while the call was running
(`sampling/createMessage`, `elicitation/create`, `roots/list`), and the client answered them by `id`
([2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). Sampling's
`includeContext` values `thisServer` and `allServers` ask the client to attach context from MCP servers to the prompt;
both are deprecated since 2025-11-25
([schema L2104-L2125](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L2104-L2125)).

## Elicitation

Servers must not use form mode to ask for passwords, API keys, access tokens or payment credentials, and must use URL
mode for them; in URL mode the URL must not contain credentials or personal data about the user, and must not be
pre-authenticated. Clients must show which server is asking, and must show the full URL and get consent before opening
it. The answer is `accept`, `decline` or `cancel`; in URL mode `accept` means the user agreed to open the link, not
that the interaction finished ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)).
URL mode arrived in 2025-11-25 ([2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)).

## Tasks: results that arrive later

| Revision | The call returns | The final result arrives in | Source |
| --- | --- | --- | --- |
| 2025-11-25 (experimental, core) | `{"task": {"taskId", "status", ...}}` when the request had `params.task` | the result of `tasks/result` with the same `taskId`; `tasks/get` and `notifications/tasks/status` report status | [schema L37-L47](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L37-L47), [L1388-L1390](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L1388-L1390), [L1419-L1427](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L1419-L1427) |
| 2026-07-28 (extension `io.modelcontextprotocol/tasks`) | `resultType: "task"` with `taskId`, `status`, `ttlMs`, `pollIntervalMs` at the top level | a `tasks/get` result (or `notifications/tasks`) with `status: "completed"` and `result`, or `status: "failed"` and `error`; `tasks/update` sends `inputResponses` | [Tasks overview](https://modelcontextprotocol.io/extensions/tasks/overview), [ext-tasks schema L180-L193](https://github.com/modelcontextprotocol/ext-tasks/blob/6c0997fbc040e6145c5cbd1e757aef9debb94303/schema/2026-07-28/schema.ts#L180-L193), [L121-L136](https://github.com/modelcontextprotocol/ext-tasks/blob/6c0997fbc040e6145c5cbd1e757aef9debb94303/schema/2026-07-28/schema.ts#L121-L136), [L227-L245](https://github.com/modelcontextprotocol/ext-tasks/blob/6c0997fbc040e6145c5cbd1e757aef9debb94303/schema/2026-07-28/schema.ts#L227-L245) |

Status values are `working`, `input_required`, `completed`, `failed` and `cancelled`. Cancelling a task is cooperative:
the server acknowledges, but the work may still finish ([Tasks overview](https://modelcontextprotocol.io/extensions/tasks/overview)).
In 2025-11-25, a tool call whose result has `isError: true` ends as `failed`
([schema L1304-L1309](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L1304-L1309)).

## Cancellation

`notifications/cancelled` names the `requestId` it cancels. The request should still be running, but the notice may
arrive after it finished ([schema L612-L632](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L612-L632)).
On Streamable HTTP in 2026-07-28 there is no cancel message: closing the request's response stream is the cancellation
([Streamable HTTP, Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)),
so a message log shows only a request without a response. Either way, a cancel does not prove the work stopped.

## What changed by revision

| Revision | What a log from it looks like | Source |
| --- | --- | --- |
| 2024-11-05 | `initialize` handshake; no tool annotations; `isError` already in tool results; HTTP+SSE transport | [2024-11-05 schema L658-L667](https://github.com/modelcontextprotocol/specification/blob/2024-11-05-final/schema/2024-11-05/schema.ts#L658-L667), [2025-03-26 changelog](https://modelcontextprotocol.io/specification/2025-03-26/changelog) |
| 2025-03-26 | Tool annotations added; JSON-RPC batches allowed; Streamable HTTP; audio content | [2025-03-26 changelog](https://modelcontextprotocol.io/specification/2025-03-26/changelog) |
| 2025-06-18 | Batches removed; `structuredContent` and `outputSchema`; resource links in results; elicitation; `title` fields; `MCP-Protocol-Version` header | [2025-06-18 changelog](https://modelcontextprotocol.io/specification/2025-06-18/changelog) |
| 2025-11-25 | Experimental tasks; tool name guidance; URL mode elicitation; tool calling inside sampling; icons; validation errors as tool execution errors | [2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog) |
| 2026-07-28 | No handshake or sessions; version, capabilities and identity in `_meta`; `server/discover`; `resultType`; multi round-trip requests; tasks as an extension; `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` headers; roots, sampling and logging deprecated | [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) |
