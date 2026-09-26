# Where tool-call logs come from and what they can show

Read this in steps 0 to 2: to find the right log, to feed it to `scripts/tool-call-table.mjs`, and to write down what
the log cannot tell you.

## Sources of evidence

| Source | What it holds | What it misses |
| --- | --- | --- |
| Host (client) log of MCP traffic | Every request, response and notification per server, often with a timestamp and server name in front of each JSON message | The user's prompt, the model's reasoning, approvals given in the host's interface, calls the host blocked before sending |
| stdio capture | One JSON-RPC message per line, exactly as sent | Which server a line belongs to, unless there is one file per server |
| Server stderr | Free text the server chose to log | MCP messages (stderr is for logs only) |
| Proxy or gateway log | Messages or HTTP metadata for Streamable HTTP servers | Bodies, if only headers are kept |
| OpenTelemetry traces | One span per tool call with timings and status; arguments and results only if the instrumentation opted in | Annotations; anything the instrumentation left out |
| The conversation transcript | The task, the user's later messages, approvals and the agent's explanations | Exact wire messages, unless the host records them |

Collect the transcript as well as the traffic whenever you can: scope and approvals come from it, the calls come from
the traffic.

## stdio

The client runs the server as a subprocess. Messages are JSON-RPC, one per line, and must not contain embedded
newlines; the server may write UTF-8 log text to stderr, and must write nothing to stdout that is not a valid MCP
message ([stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)). A capture of stdin
and stdout is therefore JSON Lines, and anything else in a mixed log is stderr or host text. The table script skips
lines that are not JSON and says how many it skipped.

## Streamable HTTP

Each client message is its own HTTP POST; the server answers with one JSON object or with a Server-Sent Events stream
that carries notifications for that request and then the final response
([Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)). In
2026-07-28 each POST also carries headers that a proxy log may keep even without bodies:

| Header | Value | Source |
| --- | --- | --- |
| `MCP-Protocol-Version` | the protocol version of the request | [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| `Mcp-Method` | the JSON-RPC `method`, for example `tools/call` | same |
| `Mcp-Name` | `params.name` for `tools/call` and `prompts/get`, `params.uri` for `resources/read` | same |
| `Mcp-Param-{Name}` | the value of each tool parameter the server marked with `x-mcp-header` | same, and [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) |

A value that is not plain ASCII is sent as `=?base64?{value}?=`; decode it before reading. Servers must reject a request
whose headers do not match its body with error `-32020`
([Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)). From
headers alone you get the list of tools called and any mirrored arguments, which is enough for scope and timing but
not for data exposure.

Revisions 2025-03-26 to 2025-11-25 differ: servers could assign an `Mcp-Session-Id`, clients could open a separate GET
stream for server messages, servers could send their own requests on SSE streams, and streams could resume with
`Last-Event-ID` ([Streamable HTTP, Earlier revisions](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)).
A log from those revisions may interleave server requests with the call they belong to.

## What the table script reads

`node scripts/tool-call-table.mjs <file> [...]` accepts, and mixes freely:

- JSON Lines of bare JSON-RPC messages;
- JSON Lines of wrapper objects: the message under `message`, `msg`, `payload`, `data`, `body`, `json`, `rpc`,
  `jsonrpc`, `frame`, `request` or `response` (an object or a JSON string); a timestamp under `ts`, `timestamp`,
  `time`, `@timestamp`, `date`, `datetime`, `receivedAt` or `sentAt` (ISO text, or epoch seconds, milliseconds or
  nanoseconds); a server name under `server`, `serverName`, `server_name`, `mcpServer`, `mcp_server`, `serverId` or
  `server_id`; and a session under `session`, `sessionId`, `session_id`, `conversationId`, `conversation_id`,
  `connectionId` or `connection_id`;
- text lines with a prefix before the JSON, such as `2026-09-20T09:14:02Z [server] --> {...}`: the first timestamp in
  the prefix is the time and the first bracketed word that is not a log level is the server;
- SSE lines (`data: {...}`);
- one JSON document: an array of messages or wrappers, an object with a `messages`, `entries`, `events`, `records`,
  `items`, `log` or `logs` array, or a JSON-RPC batch;
- OpenTelemetry OTLP JSON (`resourceSpans`), one document or one per line.

With several files, the script merges them by timestamp when every message has one, so a value read from one server
and sent to another is still traced. Without timestamps it reads the files in the order given and says so.

Give it one file per server, or a log that names the server on each line. If several servers share one unlabelled
file, their request ids collide and their tool lists merge; the script warns about reused ids.

## OpenTelemetry traces

The OpenTelemetry semantic conventions for generative AI define an `execute_tool` span for each tool execution and
client and server spans for MCP calls; both are at "Development" status
([GenAI spans, Execute tool span](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-spans.md#execute-tool-span),
[MCP conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/mcp.md)).
The MCP specification reserves `traceparent`, `tracestate` and `baggage` in `_meta` for trace context, and points to
these conventions ([MCP basic](https://modelcontextprotocol.io/specification/2026-07-28/basic)).

| Attribute | Meaning | Note |
| --- | --- | --- |
| `gen_ai.operation.name` | `execute_tool` on a tool span | Required on the execute_tool span |
| `gen_ai.tool.name` | the tool | Required on the execute_tool span |
| `gen_ai.tool.call.id` | the call's id | Recommended |
| `gen_ai.tool.call.arguments` | the arguments | Opt-in; the conventions warn it "may contain sensitive information" |
| `gen_ai.tool.call.result` | the result, if the call succeeded | Opt-in, same warning |
| `error.type` | the error class; `tool_error` when an MCP result has `isError: true` | Set only on failure |
| `mcp.method.name` | the MCP method, for example `tools/call` | Required on MCP spans |
| `jsonrpc.request.id` | the JSON-RPC `id` | On MCP client spans for requests |
| `mcp.protocol.version`, `mcp.session.id` | revision and session | Recommended |
| `server.address`, `server.port` | the MCP server | Recommended |

Sources: the attribute tables in the two convention files above. When an MCP client span sits inside an
`execute_tool` span for the same tool, the table script merges them into one call. Because arguments and results are
opt-in, a trace without them supports a timing and scope review only; the script flags `arguments-not-recorded`.

OTLP JSON uses lowerCamelCase field names, hex strings for `traceId` and `spanId`, decimal strings for 64-bit integers
such as `startTimeUnixNano`, and integers for enums such as span `kind` and status `code`
([OTLP 1.11.0, JSON Protobuf Encoding](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding)).

## Converting any other trace

Agent frameworks log tool calls in their own shapes. Rewrite them as JSON Lines of JSON-RPC messages, one request and
one response per call, and keep the original file for reference:

```json
{"ts":"<ISO time>","server":"<server or tool group>","msg":{"jsonrpc":"2.0","id":"<call id>","method":"tools/call","params":{"name":"<tool>","arguments":{}}}}
{"ts":"<ISO time>","server":"<server or tool group>","msg":{"jsonrpc":"2.0","id":"<call id>","result":{"content":[{"type":"text","text":"<output as text>"}],"isError":false}}}
```

| Framework field | JSON-RPC field |
| --- | --- |
| tool or function name | `params.name` |
| arguments (parse them if they are a JSON string) | `params.arguments` |
| call id | `id` on both lines |
| tool output | `result.content[0].text`, or `result.structuredContent` for JSON output |
| error flag or exception | `result.isError: true`, or an `error` object if the tool was never reached |
| timestamp | `ts` |

Save the tool definitions the agent had, as a `tools/list` result (`{"tools": [...]}`), and pass them with
`--tools=<file>`; otherwise every tool shows `????` and the defaults apply.

## What a log cannot show

Write these limits into the report when they apply:

- Effects beyond the server's reply. A result says what the server reports; the target system is the proof.
- Why the agent made a call. Reasoning is not in MCP traffic; the transcript may show the agent's explanation to the
  user, which is a claim, not evidence.
- Approvals given in the host's interface, unless the host logs them. The only approval visible in MCP traffic is an
  elicitation answer, and that answers the server's question.
- Calls the host refused before sending them.
- Content inside images and audio. The script does not decode base64 content, and neither should the audit agent open
  it without care: it is untrusted input.
- Anything cut by log rotation, sampling or truncation. Look for requests without responses, responses without
  requests, gaps in time and missing tool lists.
- Clock differences between sources. Compare times only within one source, or note the offset.

## Keep the evidence intact

Work on a copy. Record the SHA-256 of each original file before you start (`sha256sum <file>`, or
`Get-FileHash <file> -Algorithm SHA256` in PowerShell), and quote positions by file and line, so another person can
check each finding against the same bytes.
