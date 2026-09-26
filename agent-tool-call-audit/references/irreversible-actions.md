# Irreversible and destructive actions

Read this in step 4, check 3. For every call that changed something, answer four questions: what changed, can it be
undone, was it in scope, and did a person approve this exact change?

## Classes of action

| Class | Signals in the call | Can it be undone? |
| --- | --- | --- |
| Delete, overwrite, truncate | `delete_*`, `remove_*`, `drop`, `rm -rf`, SQL `DELETE`/`DROP`/`TRUNCATE`, `write_file` over an existing file | Only from a backup, a trash folder, soft delete or version history; ask the owner which exists |
| Send, post, publish | `send_*`, `post_*`, `comment`, `publish`, `upload`, `export`, `webhook`, email and chat tools | No. A recipient already has it; a follow-up can only correct |
| Money | `pay`, `transfer`, `charge`, `refund`, `purchase` | Only through a new, opposite transaction, if the provider allows it |
| Code and releases | `push --force`, `merge`, `deploy`, `release`, `reset --hard` | Sometimes, through history or a redeploy; a force push can lose commits for everyone |
| Access and credentials | `grant`, `revoke`, `rotate`, new users or keys, `chmod -R`, `sudo` | Partly; any use of the access in between stays done |
| Infrastructure | `terraform destroy`, `kubectl delete`, `docker system prune`, `mkfs` | Rebuild, if the definition and the data were kept elsewhere |
| Scheduled or persistent changes | cron entries, forwarding rules, webhooks, CI settings | Yes, once found; they act again until someone removes them |

The table script infers these from tool names and from command, SQL and script arguments, and prints them under the
`effect` flag. The tool name alone is weak evidence (`mcp-messages.md` and `tool-annotations.md` have the evidence
levels); the result text and the target system are stronger.

## What MCP and OWASP expect

- "There SHOULD always be a human in the loop with the ability to deny tool invocations"; applications should show
  which tools are exposed, indicate when tools are invoked, and present confirmation prompts for operations
  ([Tools, User Interaction Model](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). Clients
  should prompt for confirmation on sensitive operations and log tool usage for audit purposes
  ([Tools, Security Considerations](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- Hosts must obtain explicit user consent before invoking any tool, and users should understand what each tool does
  before authorizing its use ([Specification, Tool Safety](https://modelcontextprotocol.io/specification/2026-07-28)).
- OWASP counts "performs deletions without any confirmation from the user" as excessive autonomy and recommends
  human approval for high-impact actions ([LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)).
- The OWASP agentic list asks for human confirmation of high-impact or destructive actions (delete, transfer,
  publish), with a dry-run or diff preview before approval
  ([ASI02](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)).

## Finding the approval, and checking it

An approval usually lives in the host's interface or the transcript, not in MCP traffic. Where to look, strongest
first:

1. The host's own record of the approval prompt and the answer, if it keeps one.
2. The transcript: the agent's message that asked, the user's reply.
3. An elicitation in the MCP traffic: an `input_required` result with an `elicitation/create` request, and an
   `accept` in the retry's `inputResponses`
   ([Multi round-trip requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)). This
   shows the user answered the server's question; read the question (`message`) to see what they agreed to.

Then check the approval against the call:

- Same target and arguments. An approval for "clean up old branches" does not cover `release-candidate` unless the
  user saw that name.
- Given before the call, not after.
- Given on accurate information. The OWASP agentic list warns about approvals obtained with confident but false
  explanations, and about missing confirmation for sensitive actions, where "a single prompt" becomes an irreversible
  transfer or deletion ([ASI09, Human-Agent Trust Exploitation](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)).
  NIST describes the same risk as automation bias: people over-rely on generative AI output
  ([NIST AI 600-1, section 2.7, Human-AI Configuration](https://doi.org/10.6028/NIST.AI.600-1)). Compare what the agent
  told the user with the call's arguments.
- One approval covers one action. A retry after a timeout is a second action if the first one took effect.

No approval found is not proof that none was given; say where you looked.

## Repeats and retries

- A second call with the same tool and arguments after the first may have taken effect duplicates the effect when the
  tool is not idempotent (declared `idempotentHint: false`, or not declared). The table script flags
  `repeat-non-idempotent`. Duplicate payments, emails and comments start this way, typically with a retry after a
  timeout.
- A multi round-trip retry is a new request with a new `id`, carrying `inputResponses` and the same `requestState`
  ([Multi round-trip requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)). The
  first attempt returned `input_required`, so one retry is normal. Two completed retries with the same `requestState`
  are a replay: MCP says a server whose `requestState` must be used at most once has to enforce that itself (same
  source), so a second effect is a server finding as well as an agent finding.
- A tool execution error (`isError: true`) means the tool ran and failed, possibly after doing part of the work
  ([Tools, Error Handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). Check the target
  before calling a retry after an error harmless.

## Cancelled and unanswered calls

- A cancel notification may arrive after the request finished
  ([schema L612-L632](https://github.com/modelcontextprotocol/specification/blob/2026-07-28/schema/2026-07-28/schema.ts#L612-L632)),
  and cancelling a task is cooperative, so the work may still finish
  ([Tasks overview](https://modelcontextprotocol.io/extensions/tasks/overview)).
- A request with no response in the log has an unknown effect. Report it as unknown, with the target to check.

## Rating an irreversible action

| Situation | Starting severity (adjust in `severity-and-report.md`) |
| --- | --- |
| Irreversible action outside the task, on real data or real people, or driven by text from tool output | High or Critical |
| Irreversible action within the task, without approval where the host or policy required one | High |
| Reversible change outside the task, undone or easy to undo | Medium |
| Duplicate effect of low impact (a second comment) | Medium or Low |
| Irreversible action within the task, approved on accurate information | Not a finding; list it under "checked" |

## Common commands the script recognises

`rm -r`, `rm -f`, `rm -rf`, `Remove-Item -Recurse`, `rmdir /s`, `del /s`, `del /q`; SQL `DELETE FROM`, `DROP`, `TRUNCATE`,
`ALTER TABLE ... DROP`, `INSERT`, `UPDATE ... SET`, `GRANT`, `REVOKE`, `CREATE USER|ROLE`; `git push --force|-f`,
`git reset --hard`, `git clean -f`; `curl|wget ... | sh`; `sudo`, `doas`, `runas`; `terraform destroy`,
`kubectl delete`, `docker rm|rmi|system prune`, `helm uninstall`; `mkfs`, `dd if=`, `chmod -R`, `chown -R`; `ssh`,
`scp`, `rsync`, `sftp`; `curl -d|--data|-F|-T|--upload-file`, `Invoke-WebRequest -Method Post`. The list is a
starting point: read every command argument yourself.
