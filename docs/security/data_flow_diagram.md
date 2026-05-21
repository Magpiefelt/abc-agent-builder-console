# Data Flow Diagrams

This document captures the four canonical data-flow paths through the ABC Agent Builder Console:

1. **User login** (Entra ID OIDC)
2. **Free Agent execution** (single-prompt agent loop)
3. **Workflow execution** (multi-step canvas)
4. **PII block path** (a prompt is rejected before it leaves the perimeter)

Each sequence cites the implementing files. Reviewers should be able to trace any data element from origin to rest by following the diagrams below in conjunction with `threat_model_stride.md` and `controls_matrix.md`.

---

## 1. User login (SSO)

```mermaid
sequenceDiagram
    autonumber
    actor U as User (Browser)
    participant FE as Frontend SPA
    participant E as Entra ID
    participant BE as Backend API
    participant DB as PostgreSQL

    U->>FE: GET /
    FE->>BE: GET /api/me
    Note over BE: authenticate middleware<br/>(middleware/auth.ts)
    alt No Bearer token
        BE-->>FE: 401 Unauthorized
        FE->>E: Redirect (OIDC authorize)
        U->>E: Sign in
        E-->>FE: 302 with id_token + access_token
        FE->>BE: GET /api/me<br/>Authorization: Bearer ...
    end
    BE->>E: GET JWKS (verify signature)
    E-->>BE: Public keys
    Note over BE: Validate signature,<br/>aud, iss, exp.<br/>Extract oid, email,<br/>groups.<br/>Derive ministry via<br/>extractMinistry(groups)
    BE->>DB: SELECT/INSERT users<br/>(parameterized)
    DB-->>BE: user row
    BE->>DB: INSERT audit_log<br/>(AUTH_LOGIN)
    BE-->>FE: 200 { user }
    FE->>FE: stores/auth.ts<br/>caches user
```

**Implementation references**

- `backend/src/middleware/auth.ts` — `authenticate`, `extractMinistry`, `DEV_USER` mock
- `backend/src/services/auditLogger.ts` — `AuditAction.AUTH_LOGIN`
- `frontend/src/stores/auth.ts` — `loadUser()`
- Stream A delivers production JWT validation. Today, in `NODE_ENV=development`, the backend short-circuits to `DEV_USER`.

---

## 2. Free Agent execution

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Frontend
    participant BE as Backend
    participant DB as PostgreSQL
    participant LLM as Vertex AI (Claude)
    participant T as Tool

    U->>FE: Submit prompt + model
    FE->>BE: POST /api/agent/sessions<br/>{ prompt, modelId, classification }
    Note over BE: scanForPII(prompt, ctx)<br/>(services/piiDetector.ts)
    alt PII blocked
        BE->>DB: INSERT pii_detections
        BE->>DB: INSERT audit_log (PII_BLOCKED_PROMPT)
        BE-->>FE: 422 with redacted detection list
    else clean
        BE->>BE: validateModelClassification()
        BE->>DB: INSERT agent_sessions
        BE->>DB: INSERT audit_log (AGENT_SESSION_CREATED)
        BE-->>FE: 201 { id, status: idle }
    end
    FE->>BE: POST /api/agent/sessions/:id/start (SSE)
    loop until completed / max iterations
        BE->>LLM: POST /v1/messages<br/>(system + history + tools)
        LLM-->>BE: assistant turn (text + tool_use[])
        Note over BE: recordTokenUsage()
        opt tool_use present
            BE->>T: dispatch(tool, params)
            T-->>BE: result (scanForPII on return)
            BE->>DB: INSERT agent_iterations
            BE->>DB: INSERT audit_log (TOOL_EXECUTED)
        end
        BE-->>FE: SSE { iteration: n, status, blackboard, deltas }
    end
    BE->>DB: UPDATE agent_sessions SET status=completed
    BE->>DB: INSERT audit_log (AGENT_SESSION_COMPLETED)
    BE-->>FE: SSE { type: done }
```

**Implementation references**

- `backend/src/routes/agent.ts:46` — `POST /sessions`
- `backend/src/services/piiDetector.ts:scanForPII`
- `backend/src/services/llmProvider.ts:streamLLM`, `recordTokenUsage`
- `backend/src/services/agentOrchestrator.ts:runOrchestrator`
- `backend/src/services/toolDispatcher.ts`

---

## 3. Workflow execution

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Frontend (Vue Flow canvas)
    participant BE as Backend
    participant DB as PostgreSQL
    participant LLM as Vertex AI
    participant T as Tools

    U->>FE: Build / load workflow
    FE->>BE: POST /api/workflows<br/>{ nodes, edges, classification }
    BE->>DB: INSERT workflows<br/>INSERT audit_log (WORKFLOW_CREATED)
    BE-->>FE: 201 { id }
    U->>FE: Execute
    FE->>BE: POST /api/workflows/:id/execute (SSE)
    loop topological pass over nodes
        BE->>BE: For each node:<br/>resolve inputs from prior outputs
        Note over BE: scanForPII(node input, ctx)
        alt PII blocked
            BE->>DB: INSERT pii_detections
            BE-->>FE: SSE { node, status: blocked }
        else
            alt node is LLM
                BE->>LLM: call
                LLM-->>BE: response
            else node is Tool
                BE->>T: dispatch
                T-->>BE: result
            end
        end
        BE->>DB: INSERT workflow_executions step
        BE-->>FE: SSE { node, status: complete, output }
    end
    BE->>DB: INSERT audit_log (WORKFLOW_EXECUTED)
    BE-->>FE: SSE { type: done }
```

**Implementation references**

- Stream C delivers the workflow executor; this diagram represents the agreed contract.
- Audit and PII scanning are reused from the Free Agent path — the same `scanForPII` and `auditAction` calls are wired in per node.

---

## 4. PII block path

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Frontend
    participant BE as Backend
    participant Det as piiDetector
    participant DB as PostgreSQL

    U->>FE: Submit prompt containing SIN/AHCN/JWT
    FE->>BE: POST /api/agent/sessions { prompt }
    BE->>Det: scanForPII(prompt, { userId })
    Note over Det: For each pattern:<br/>regex match → optional<br/>Luhn check → emit detection<br/>(truncated to 4 chars + ***)
    Det->>DB: INSERT pii_detections<br/>(fire-and-forget, per detection)
    Det-->>BE: { blockedCount > 0, detections[] }
    BE->>DB: INSERT audit_log (PII_BLOCKED_PROMPT)
    BE-->>FE: 422<br/>{ error, detections: [{ type }] }
    Note over FE: Toast user:<br/>"Prompt contains blocked content."
    Note over BE: LLM was NEVER called.<br/>No data leaves the perimeter.
```

**Implementation references**

- `backend/src/services/piiDetector.ts` — patterns, Luhn validation, `scanForPII`, `logDetections`
- `backend/src/routes/agent.ts:60-78` — block-and-return on `blockedCount > 0`
- `backend/src/services/auditLogger.ts:AuditAction.PII_BLOCKED_PROMPT`
- Truncation (`match.substring(0, 4) + "***"`) ensures raw matches never reach the DB, the response, or any log line.

---

## Cross-cutting properties

- **Every external egress is preceded by a PII scan.** This is the single chokepoint, enforced in `piiDetector.scanForPII` and called at all session-creation, continuation, interjection, and (in Stream C) per-workflow-node entry points.
- **All state-changing operations write an audit entry.** Audit failures never block the request (fire-and-forget).
- **All SSE streams clean up on client disconnect.** `req.on('close', stopSession)` ensures abandoned sessions stop their LLM loops.
- **All DB access is parameterized.** No `query()` call uses string concatenation for user input.
