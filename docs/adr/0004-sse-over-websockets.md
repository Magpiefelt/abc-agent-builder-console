# ADR-0004: Server-Sent Events over WebSockets for streaming

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** ABC core engineering

## Context

Both operating modes — Free Agent and Workflow — stream long-running
state changes from the server to the browser:

- Free Agent: `iteration_start`, `llm_response`, `tool_calls`,
  `tool_result`, `blackboard_update`, `scratchpad_update`, `iteration_complete`,
  `session_complete`, ~16 event types total (see
  `services/agentOrchestrator.ts`).
- Workflow: `workflow_start`, `stage_start`, `stage_complete`,
  `workflow_complete`.

The wire format choice was either Server-Sent Events (SSE, the
`EventSource` API plus our custom `fetch`-based POST wrapper in
`useSSEStream.ts`) or WebSockets.

## Decision

Use Server-Sent Events. Concretely:

- Backend writes `data: {...}\n\n` lines on a chunked-encoding HTTP response.
- The starter endpoint (e.g. `POST /api/agent/sessions/:id/start`) accepts
  a JSON body of session params and switches the response to SSE format
  for the duration of the session.
- Frontend uses a custom `useSSEStream` composable rather than the native
  `EventSource` API. `EventSource` only supports GET; our start endpoints
  need POST bodies (prompt overrides, classification, etc.). Our composable
  does `fetch + ReadableStream + line-buffered parse` to get the same
  semantics as `EventSource` over a POST request.
- One direction only — server-to-client. Stop/continue/interject from the
  client are separate POST endpoints, not in-stream messages.

## Consequences

**Positive.**

- Plain HTTP. No protocol upgrade, no separate port, no separate auth
  flow — the existing `abc_session` cookie just works.
- Plays nicely with Nexus / load balancers / CDN intermediaries that may
  be hostile to WebSocket upgrades.
- Native browser support for `EventSource` (which we don't use directly,
  but the lineage is well-trodden — reconnection, line-buffer parsing,
  exponential backoff are all reference patterns).
- The orchestrator can emit events synchronously into the response stream;
  no separate pub/sub layer or WebSocket session manager.
- Easy to debug — events are visible as plain text in the browser
  DevTools Network panel.

**Negative.**

- One-way only. We can't push a stop event from server to client mid-stream
  — but we don't need to: the client just closes the connection.
- HTTP/1.1 has a 6-connections-per-origin browser limit. A user with
  three simultaneous Free Agent sessions and a workflow run uses 4
  connections; well below the limit. HTTP/2 raises this further.
- No native binary frame support. Tool results that contain bytes (images,
  audio) are base64-encoded and inlined. The base64 overhead is real but
  acceptable for our payload sizes (< 1 MB per event).
- The streaming POST pattern requires a custom client composable
  (`useSSEStream`) instead of `new EventSource(url)`. That's ~50 lines of
  code; trivial.

## Alternatives considered

1. **WebSockets.** Rejected: protocol-upgrade handshake adds complexity in
   the load balancer; auth requires either a custom Bearer-in-query-param
   handshake (insecure) or a session cookie that doesn't always flow
   through WS upgrade requests; debugging is harder; we don't need
   bidirectional messaging.
2. **Long polling.** Rejected: latency on event delivery (each event
   becomes a new request); state-tracking burden on the client; existing
   solution (SSE) is strictly better.
3. **HTTP/2 server push.** Rejected: depends on infrastructure that may
   not expose H2 to the application layer in Nexus.
4. **Native `EventSource` (GET-only).** Rejected: our start endpoints need
   POST bodies for session params; the custom `useSSEStream` is the cost
   of being able to pass those.

## Notes for future contributors

When adding a new streaming endpoint, **follow the existing pattern**:

- Stream method = `POST` (params in body).
- Response headers: `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`.
- Each event is `data: ${JSON.stringify(payload)}\n\n` — no `event:` line
  unless you need a discriminated `EventSource` listener (we don't, since
  our payload includes its own `type` discriminator).
- Always flush after each write (Node Express does this automatically;
  some intermediaries need explicit `res.flush()`).
- Close the response cleanly on session-terminal — never leave it open
  indefinitely.
