# Tool annotations and how to check a call against them

Read this in step 4, check 5 (annotation mismatch), and whenever a host's approval policy depends on annotations.
Facts are from the MCP specification, revision 2026-07-28, with the history of the field from 2025-03-26.

## The hints

A tool definition may carry `annotations` ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
The four behaviour hints and their defaults, from `ToolAnnotations`
([schema L1900-L1954](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L1900-L1954)):

| Hint | Meaning when `true` | Meaning when `false` | Default when missing | Applies |
| --- | --- | --- | --- | --- |
| `readOnlyHint` | The tool does not modify its environment | It may modify it | `false` | always |
| `destructiveHint` | The tool may perform destructive updates | It performs only additive updates | `true` | only when `readOnlyHint` is `false` |
| `idempotentHint` | Calling it again with the same arguments has no additional effect | A repeat may have a further effect | `false` | only when `readOnlyHint` is `false` |
| `openWorldHint` | The tool may interact with an "open world" of external entities (the schema's example: web search) | Its domain is closed (the schema's example: a memory tool) | `true` | always |

`annotations.title` is a display name; the tool's own `title` takes precedence, then `annotations.title`, then `name`
([schema L1973-L2015](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L1973-L2015)).

The defaults are the cautious reading: a tool that declares nothing counts as not read-only, destructive, not
idempotent and open world. A host that shows a tool without annotations as safe, or that auto-approves it, has the
defaults backwards.

## Hints are not guarantees

The specification says so three times:

- The schema: all properties in `ToolAnnotations` are hints, "not guaranteed to provide a faithful description of tool
  behavior", and "Clients should never make tool use decisions based on `ToolAnnotations` received from untrusted
  servers" ([schema L1900-L1954](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L1900-L1954)).
- The tools page: clients MUST consider tool annotations untrusted unless they come from trusted servers
  ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- The overview: descriptions of tool behaviour such as annotations should be considered untrusted unless obtained from
  a trusted server ([Specification, Tool Safety](https://modelcontextprotocol.io/specification/2026-07-28)).

So a mismatch is two findings at once: the server declared something false (report it to the server's maintainer),
and anything that trusted the declaration, such as an approval rule, trusted an untrusted source (report it to whoever
configures the host).

## History

Annotations were added in 2025-03-26 ([changelog](https://modelcontextprotocol.io/specification/2025-03-26/changelog),
[2025-03-26 schema L720-L772](https://github.com/modelcontextprotocol/specification/blob/2025-03-26/schema/2025-03-26/schema.ts#L720-L772)).
The four hints and their defaults read the same in 2026-07-28; the only difference in the text is a typo fix
(compared on 2026-09-26). A log from a 2024-11-05 server has no annotations at all, so every tool in it gets the
defaults.

## The code in the call table

`scripts/tool-call-table.mjs` prints the hints as four letters:

| Position | Letters | Uppercase | Lowercase | `-` |
| --- | --- | --- | --- | --- |
| 1 | `R` / `W` | declared read-only / declared not read-only | `w`: not declared, default not read-only | |
| 2 | `D` / `A` | declared destructive / declared additive | `d`: not declared, default destructive | read-only tool |
| 3 | `I` / `N` | declared idempotent / declared not idempotent | `n`: not declared, default not idempotent | read-only tool |
| 4 | `O` / `C` | declared open world / declared closed world | `o`: not declared, default open world | |

`????` means the log has no definition for the tool; the defaults apply (`wdno`). Pass a saved `tools/list` result
with `--tools=<file>` when the definitions live elsewhere, such as for an OpenTelemetry trace, which records no
annotations.

## Judging what a call did

Work from the strongest evidence down, and write down which level you used:

1. The result says what changed ("Deleted branch...", "4 rows affected", "Comment 9001 added").
2. A later call in the log observes the change (a list that no longer has the item, a second read with new content).
3. The arguments name the operation: a SQL `DELETE`, `rm -rf`, `git push --force`, a URL that carries data out.
4. The tool name and description ("delete_branch", "send_email").
5. Nothing: the tool name is neutral and the result is empty. Record the effect as unknown.

A tool result reports what the server says it did. Only the system on the other side can confirm it (the repository's
branch list, the mail server's sent log), so a finding that matters should name the record to check there.

## Mismatch patterns

| Declared | What the log shows | What it means | Where to report |
| --- | --- | --- | --- |
| `readOnlyHint: true` | A write, delete, send or command in the arguments, or a result that reports a change | The server under-declares; any rule that auto-approves read-only tools approved a write | Server maintainer; host configuration |
| `destructiveHint: false` | A delete, overwrite, truncate or revoke | Approval rules that allow "additive" tools let a destructive one through | Server maintainer; host configuration |
| `idempotentHint: true` | The same arguments twice, with different results or a second effect | Retries and replays are not safe with this tool | Server maintainer |
| `openWorldHint: false` | A URL, remote host or outbound send in the arguments | Data can leave through a tool declared closed | Server maintainer; data exposure check |
| (none declared) | Any call | Defaults apply; nothing about the tool was promised | Host configuration if the host treated it as safe |
| A definition that changed mid-session | New description, annotations or input schema after `notifications/tools/list_changed` | The client may have approved the tool under the old definition; a changed description can carry instructions (`injected-instructions.md`) | Server maintainer; treat the server as untrusted until explained |

A tool that is "read-only" towards its own service can still send data out: a fetch tool that puts file contents into a
URL changes nothing on the target and still leaks. Report that under data exposure, not as an annotation mismatch,
unless the tool also declared `openWorldHint: false`.

## Related fields worth reading

- `x-mcp-header` on an input property copies its value into an `Mcp-Param-{name}` HTTP header on Streamable HTTP.
  Servers should not mark passwords, API keys, tokens or personal data this way, because intermediaries can see header
  values ([Tools, x-mcp-header](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). The call table
  lists mirrored parameters and marks the ones whose names look sensitive.
- Tool names are unique only within one server; aggregating clients should disambiguate
  ([Tools, Tool Names](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). A tool name shared by
  two servers makes "which server ran this call" a question to answer before any finding. The OWASP agentic list
  describes a malicious tool named `report` being resolved before `report_finance`
  ([OWASP Top 10 for Agentic Applications for 2026, ASI02](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)).
- 2025-11-25 tools may declare `execution.taskSupport` (`forbidden`, the default, `optional` or `required`)
  ([2025-11-25 schema L1222-L1240](https://github.com/modelcontextprotocol/specification/blob/2025-11-25/schema/2025-11-25/schema.ts#L1222-L1240));
  a task-augmented call delivers its result later (`mcp-messages.md`, Tasks).
