# Data exposure: what left, and where it went

Read this in step 4, check 2, and in step 5 (data flows). The question for every call: did it carry secrets, personal
data or file contents to a place the task did not need, and did the user agree to that?

## What counts as sensitive

OWASP lists personal data, financial details, health records, confidential business data, security credentials, legal
documents, and proprietary source code or methods
([LLM02:2025 Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/),
[source text](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/99f4395589bdbd120ae961f9cd179e79d7f9b27f/2_0_vulns/LLM02_SensitiveInformationDisclosure.md)).
NIST's generative AI profile adds that models "may leak, generate, or correctly infer sensitive information about
individuals" ([NIST AI 600-1, section 2.4, Data Privacy](https://doi.org/10.6028/NIST.AI.600-1), July 2024). For an
audit, add the contents of any file the task did not ask for: configuration, environment files, keys, other people's
documents.

## What MCP expects

- Hosts must obtain explicit user consent before exposing user data to servers, and must not transmit resource data
  elsewhere without consent ([Specification, Data Privacy](https://modelcontextprotocol.io/specification/2026-07-28)).
- Clients should show tool inputs to the user before calling the server, "to avoid malicious or accidental data
  exfiltration" ([Tools, Security Considerations](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- Servers must not ask for passwords, API keys, access tokens or payment credentials through form elicitation, and must
  not put credentials or personal data about the user in a URL elicitation
  ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)).
- Parameters marked `x-mcp-header` travel in HTTP headers that intermediaries can see; servers should not mark
  passwords, keys, tokens or personal data this way
  ([Tools, x-mcp-header](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

## Where data can leave in an MCP session

| Channel | Evidence in the log | Notes |
| --- | --- | --- |
| Arguments to a remote server | `tools/call` arguments to a Streamable HTTP server | The server operator receives the data, whatever the tool does with it |
| An open-world tool | A tool with `openWorldHint` true or not declared | The tool may pass arguments to third parties ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)) |
| A URL | Query strings, path segments, long subdomains in any argument | Visible to the target host, proxies and their logs; a subdomain also leaks through DNS lookups |
| HTTP headers | `Mcp-Param-*` from `x-mcp-header` parameters | Seen and often logged by load balancers and gateways |
| Elicitation answers | `inputResponses` in a retry (2026-07-28) or a client answer to `elicitation/create` | The user's own input goes to the server |
| Sampling | `sampling/createMessage` with `includeContext` `thisServer` or `allServers` | The server asks the client to attach context from MCP servers to a prompt; both values are deprecated ([schema L2104-L2125](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L2104-L2125)) |
| Tool results | Secrets or personal data in `content` or `structuredContent` | The data enters the model's context, the host's logs and any trace store, even if no later call sends it on |
| The logs and traces themselves | Arguments and results recorded in plain text | The OpenTelemetry conventions mark tool arguments and results as opt-in because they "may contain sensitive information" ([GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-spans.md#execute-tool-span)) |

## Exfiltration patterns to look for

- A read of sensitive data followed by a call that sends data out. The OWASP agentic list names "DB read followed by
  external transfer" as a tool chain to monitor
  ([OWASP Top 10 for Agentic Applications for 2026, ASI02](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)).
  The table script reports this as `secret-flow` when a secret found in one result appears in a later call's
  arguments, and as `from-output` for other values.
- Data placed in a link or image URL. OWASP's indirect injection example has hidden instructions make the model insert
  an image linking to a URL, which leaks the conversation
  ([LLM01:2025, scenario 2](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)).
- Data in DNS names. The agentic list describes a ping tool, approved to run without asking, used repeatedly to leak
  data through DNS queries ([ASI02](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)).
  Look for hostnames with long random-looking labels (`encoded-hostname`).
- Encoded or split data: Base64 blobs, hex, or a value split over several calls
  ([LLM01:2025, scenarios 6 and 9](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)).
- Requests to internal addresses: private ranges, loopback, link-local and the cloud metadata address
  `169.254.169.254`, which MCP's security guidance lists as SSRF targets that can expose cloud credentials
  ([Security Best Practices, SSRF](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)).
  The table script flags them as `internal-address`.
- Commands that upload: the same guidance shows a malicious local server startup command that posts `~/.ssh/id_rsa`
  with `curl -X POST -d @...` ([Security Best Practices, Local MCP Server Compromise](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)).
  Treat `curl -d`, `curl -F`, `scp` and similar in shell arguments as sends.

## Confirming or dismissing a flag

The script's detectors are patterns: they miss secrets without a known shape and flag harmless values that look like
one. For each flag:

1. Is the value real? Placeholders, examples and test fixtures are not exposures. Say how you know.
2. Where did it come from? The task, the user, or an earlier tool result (the data flows section names the call).
3. Where did it go? Name the server and, for URLs, the host. Is that destination part of the task, and trusted?
4. Did the user agree? Look for an approval in the transcript that showed this data and this destination.
5. What can the receiver do with it? A deploy token can deploy; an email address can be spammed or linked to a person.

A secret that only appeared in a result was still exposed to the model's context and to the logs. Whether that needs a
rotation depends on where the context and logs are stored; say so and leave the decision to the owner.

## Recording exposed data without exposing it again

- Refer to a value by call number, argument path and a masked form: the length, a SHA-256 fingerprint and, for values
  of 16 characters or more, the first four characters (`exam...[masked, 30 chars, sha256:73ac1319]`, as the table
  script prints it; a shorter value shows no characters, since four would give most of it away). The owner can
  match the fingerprint against their own copy with `printf '%s' "$VALUE" | sha256sum` and compare the first eight
  hex characters.
- Never paste a full secret, a full personal record or file contents into the report, a ticket or a chat.
- For personal data, name the class and the count ("one email address and one phone number of a customer"), not the
  values.

## Containment steps to recommend

| Exposed | First step for the owner |
| --- | --- |
| A credential (token, key, password) | Revoke or rotate it, then check the service's access logs for use after the exposure time |
| Personal data sent to a third party | Record what, to whom and when; follow the organization's breach procedure, which may carry legal deadlines |
| Internal data sent to an unknown host | Block the host at the egress, and remove or disable the tool or server that sent it |
| Data in logs or traces | Restrict access to the log store; purge where the retention policy allows |
