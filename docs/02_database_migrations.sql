-- ============================================================================
-- ABC Greenfield Rebuild: Database Migration Script
-- Schema: cohen_mcleod
-- Author: Cohen McLeod
-- Date: 2026-05-20
-- Approach: REBUILD (not migration)
-- 
-- IMPORTANT: This script is IDEMPOTENT and ADDITIVE.
-- It can be re-run without error.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS cohen_mcleod;
SET search_path TO cohen_mcleod, public;

-- ============================================================================
-- EXERCISE PLANNING TABLES
-- ============================================================================

-- TABLE: features (exercise requirement - maps the spec app's capabilities)
CREATE TABLE IF NOT EXISTS cohen_mcleod.features (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'screen', 'feature', 'endpoint', 'dependency', 'component', 'hook', 'utility'
    )),
    subcategory TEXT,
    description TEXT NOT NULL,
    source_file TEXT,
    mode TEXT CHECK (mode IN ('workflow', 'freeAgent', 'shared', 'backend')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'deprecated', 'broken', 'partial', 'planned'
    )),
    build_priority TEXT CHECK (build_priority IN (
        'critical', 'high', 'medium', 'low', 'optional'
    )),
    build_phase INTEGER CHECK (build_phase BETWEEN 1 AND 6),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_category ON cohen_mcleod.features(category);
CREATE INDEX IF NOT EXISTS idx_features_phase ON cohen_mcleod.features(build_phase);

-- TABLE: vulnerabilities (exercise requirement - why we're rebuilding)
CREATE TABLE IF NOT EXISTS cohen_mcleod.vulnerabilities (
    id SERIAL PRIMARY KEY,
    vuln_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'authentication', 'authorization', 'injection', 'exposure',
        'configuration', 'cryptography', 'input_validation', 'logging',
        'availability', 'privacy', 'dependency', 'architecture'
    )),
    severity TEXT NOT NULL CHECK (severity IN (
        'critical', 'high', 'medium', 'low', 'informational'
    )),
    description TEXT NOT NULL,
    impact TEXT NOT NULL,
    how_rebuild_addresses TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'addressed_by_rebuild' CHECK (status IN (
        'addressed_by_rebuild', 'requires_implementation', 'accepted_risk'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vulns_severity ON cohen_mcleod.vulnerabilities(severity);

-- TABLE: migration (exercise requirement - reframed as build steps)
CREATE TABLE IF NOT EXISTS cohen_mcleod.migration (
    id SERIAL PRIMARY KEY,
    phase INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 6),
    phase_title TEXT NOT NULL,
    step_number TEXT NOT NULL,
    task_title TEXT NOT NULL,
    description TEXT NOT NULL,
    new_files TEXT[],
    effort_points INTEGER CHECK (effort_points BETWEEN 1 AND 13),
    risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
        'planned', 'in_progress', 'blocked', 'completed', 'skipped'
    )),
    acceptance_criteria TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migration_phase ON cohen_mcleod.migration(phase);
CREATE INDEX IF NOT EXISTS idx_migration_status ON cohen_mcleod.migration(status);

-- TABLE: plan (exercise requirement - granular project plan)
CREATE TABLE IF NOT EXISTS cohen_mcleod.plan (
    id SERIAL PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    parent_task_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    phase INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 6),
    category TEXT NOT NULL CHECK (category IN (
        'setup', 'backend', 'frontend', 'security', 'privacy',
        'testing', 'ux', 'deployment', 'documentation', 'review'
    )),
    priority TEXT NOT NULL CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
    status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN (
        'backlog', 'ready', 'in_progress', 'review', 'done', 'blocked', 'cancelled'
    )),
    blocked_by TEXT[],
    effort_points INTEGER CHECK (effort_points BETWEEN 1 AND 13),
    acceptance_criteria TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_phase ON cohen_mcleod.plan(phase);
CREATE INDEX IF NOT EXISTS idx_plan_status ON cohen_mcleod.plan(status);
CREATE INDEX IF NOT EXISTS idx_plan_priority ON cohen_mcleod.plan(priority);

-- TABLE: privacy_controls (exercise requirement)
CREATE TABLE IF NOT EXISTS cohen_mcleod.privacy_controls (
    id SERIAL PRIMARY KEY,
    control_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'pii_detection', 'data_classification', 'access_control',
        'audit', 'encryption', 'retention', 'consent', 'segmentation',
        'export_control', 'incident_response'
    )),
    classification_level TEXT CHECK (classification_level IN (
        'unclassified', 'protected_a', 'protected_b'
    )),
    description TEXT NOT NULL,
    implementation_approach TEXT NOT NULL,
    build_phase INTEGER CHECK (build_phase BETWEEN 1 AND 6),
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
        'planned', 'in_progress', 'implemented', 'tested', 'verified'
    )),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_category ON cohen_mcleod.privacy_controls(category);

-- ============================================================================
-- APPLICATION TABLES (for the new build)
-- ============================================================================

-- Users (populated from Entra ID on login)
CREATE TABLE IF NOT EXISTS cohen_mcleod.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entra_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    ministry_code TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_entra ON cohen_mcleod.users(entra_id);
CREATE INDEX IF NOT EXISTS idx_users_ministry ON cohen_mcleod.users(ministry_code);

-- Model Registry (admin-managed approved LLMs)
CREATE TABLE IF NOT EXISTS cohen_mcleod.model_registry (
    id SERIAL PRIMARY KEY,
    model_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('vertex_ai', 'openai', 'anthropic', 'xai', 'google')),
    api_model_name TEXT NOT NULL,
    max_output_tokens INTEGER NOT NULL DEFAULT 16384,
    supports_streaming BOOLEAN NOT NULL DEFAULT true,
    supports_tools BOOLEAN NOT NULL DEFAULT true,
    data_residency TEXT NOT NULL DEFAULT 'canada',
    max_classification TEXT NOT NULL DEFAULT 'protected_b' CHECK (max_classification IN ('unclassified', 'protected_a', 'protected_b')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflows (saved canvas configurations)
CREATE TABLE IF NOT EXISTS cohen_mcleod.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id),
    ministry_code TEXT,
    name TEXT NOT NULL DEFAULT 'Untitled Workflow',
    description TEXT,
    classification TEXT NOT NULL DEFAULT 'unclassified' CHECK (classification IN ('unclassified', 'protected_a', 'protected_b')),
    canvas_data JSONB NOT NULL DEFAULT '{}',
    is_template BOOLEAN NOT NULL DEFAULT false,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_user ON cohen_mcleod.workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_ministry ON cohen_mcleod.workflows(ministry_code);

-- Agent Sessions (Free Agent runs)
CREATE TABLE IF NOT EXISTS cohen_mcleod.agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id),
    ministry_code TEXT,
    prompt TEXT NOT NULL,
    model_id TEXT NOT NULL,
    max_iterations INTEGER NOT NULL DEFAULT 50,
    current_iteration INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN (
        'idle', 'running', 'paused', 'completed', 'error', 'needs_assistance'
    )),
    classification TEXT NOT NULL DEFAULT 'unclassified',
    -- Server-side memory
    blackboard JSONB NOT NULL DEFAULT '[]',
    scratchpad TEXT NOT NULL DEFAULT '',
    attributes JSONB NOT NULL DEFAULT '{}',
    -- Results
    final_report JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON cohen_mcleod.agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON cohen_mcleod.agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_ministry ON cohen_mcleod.agent_sessions(ministry_code);

-- Agent Iterations (per-step execution data)
CREATE TABLE IF NOT EXISTS cohen_mcleod.agent_iterations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES cohen_mcleod.agent_sessions(id) ON DELETE CASCADE,
    iteration_number INTEGER NOT NULL,
    -- LLM interaction
    system_prompt_hash TEXT,
    user_prompt TEXT,
    raw_llm_response TEXT,
    parsed_response JSONB,
    -- Results
    tool_calls JSONB DEFAULT '[]',
    tool_results JSONB DEFAULT '[]',
    blackboard_entry JSONB,
    status TEXT NOT NULL DEFAULT 'in_progress',
    error TEXT,
    -- Metrics
    tokens_used INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iterations_session ON cohen_mcleod.agent_iterations(session_id);

-- Artifacts (generated files and content)
CREATE TABLE IF NOT EXISTS cohen_mcleod.artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES cohen_mcleod.agent_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id),
    artifact_type TEXT NOT NULL CHECK (artifact_type IN ('text', 'file', 'image', 'audio', 'data')),
    title TEXT NOT NULL,
    content TEXT,
    description TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    iteration INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_session ON cohen_mcleod.artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_user ON cohen_mcleod.artifacts(user_id);

-- Audit Log (immutable)
CREATE TABLE IF NOT EXISTS cohen_mcleod.audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID,
    ministry_code TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON cohen_mcleod.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON cohen_mcleod.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON cohen_mcleod.audit_log(created_at);

-- PII Detections (logged when PII is found)
CREATE TABLE IF NOT EXISTS cohen_mcleod.pii_detections (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES cohen_mcleod.users(id),
    session_id UUID,
    detection_type TEXT NOT NULL,
    pattern_matched TEXT NOT NULL,
    action_taken TEXT NOT NULL CHECK (action_taken IN ('blocked', 'redacted', 'flagged', 'allowed')),
    context_snippet TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pii_user ON cohen_mcleod.pii_detections(user_id);
CREATE INDEX IF NOT EXISTS idx_pii_type ON cohen_mcleod.pii_detections(detection_type);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION cohen_mcleod.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_features_updated ON cohen_mcleod.features;
CREATE TRIGGER trg_features_updated BEFORE UPDATE ON cohen_mcleod.features FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

DROP TRIGGER IF EXISTS trg_vulns_updated ON cohen_mcleod.vulnerabilities;
CREATE TRIGGER trg_vulns_updated BEFORE UPDATE ON cohen_mcleod.vulnerabilities FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

DROP TRIGGER IF EXISTS trg_migration_updated ON cohen_mcleod.migration;
CREATE TRIGGER trg_migration_updated BEFORE UPDATE ON cohen_mcleod.migration FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

DROP TRIGGER IF EXISTS trg_plan_updated ON cohen_mcleod.plan;
CREATE TRIGGER trg_plan_updated BEFORE UPDATE ON cohen_mcleod.plan FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

DROP TRIGGER IF EXISTS trg_privacy_updated ON cohen_mcleod.privacy_controls;
CREATE TRIGGER trg_privacy_updated BEFORE UPDATE ON cohen_mcleod.privacy_controls FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

DROP TRIGGER IF EXISTS trg_users_updated ON cohen_mcleod.users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON cohen_mcleod.users FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

DROP TRIGGER IF EXISTS trg_workflows_updated ON cohen_mcleod.workflows;
CREATE TRIGGER trg_workflows_updated BEFORE UPDATE ON cohen_mcleod.workflows FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

DROP TRIGGER IF EXISTS trg_sessions_updated ON cohen_mcleod.agent_sessions;
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON cohen_mcleod.agent_sessions FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

-- ============================================================================
-- SEED DATA: Plan Table (Rebuild Tasks)
-- ============================================================================

INSERT INTO cohen_mcleod.plan (task_id, title, description, phase, category, priority, status, effort_points, acceptance_criteria)
VALUES
-- Phase 1: Foundation & Security Core
('R1-001', 'Initialize monorepo workspace', 'Create pnpm workspace with frontend/, backend/, shared/ directories and root configs', 1, 'setup', 'p0', 'backlog', 2, ARRAY['pnpm install works', 'both packages build independently']),
('R1-002', 'Set up Express backend with TypeScript', 'Express 5, TypeScript strict mode, health endpoint, middleware structure', 1, 'backend', 'p0', 'backlog', 3, ARRAY['GET /health returns 200', 'TypeScript compiles cleanly']),
('R1-003', 'Implement Entra ID OIDC authentication', 'passport-azure-ad integration, login/callback/logout routes, session management', 1, 'security', 'p0', 'backlog', 5, ARRAY['User can log in via GoA SSO', 'JWT validated on protected routes', 'Ministry extracted from token groups']),
('R1-004', 'Create database schema and run migrations', 'All application tables in cohen_mcleod schema on shared Render PostgreSQL', 1, 'backend', 'p0', 'backlog', 5, ARRAY['All tables created successfully', 'Migrations are idempotent']),
('R1-005', 'Implement RBAC middleware', 'Role-based access control checking user role and ministry on every request', 1, 'security', 'p0', 'backlog', 3, ARRAY['Admin routes reject non-admin users', 'Ministry-scoped queries filter correctly']),
('R1-006', 'Build PII detection service', 'Regex-based scanner with configurable patterns, runs before all LLM calls', 1, 'privacy', 'p0', 'backlog', 5, ARRAY['Detects SIN, health numbers, emails, API keys', 'Blocks or redacts based on severity', 'Logs all detections']),
('R1-007', 'Implement audit logging service', 'Structured audit trail writing to audit_log table on every API action', 1, 'security', 'p1', 'backlog', 3, ARRAY['All API calls generate audit entries', 'Entries include user_id, action, resource']),

-- Phase 2: Backend Orchestration Engine
('R2-001', 'Build LLM provider factory', 'Configurable model routing driven by model_registry table, supports Vertex AI Claude', 2, 'backend', 'p0', 'backlog', 5, ARRAY['Can call Vertex AI Claude successfully', 'Model selection driven by database registry', 'Unsupported models rejected gracefully']),
('R2-002', 'Implement server-side iteration loop', 'The core agent execution loop: prompt assembly, LLM call, response parsing, tool dispatch', 2, 'backend', 'p0', 'backlog', 8, ARRAY['Agent runs for N iterations', 'Memory persists between iterations in DB', 'Status updates streamed via SSE']),
('R2-003', 'Implement server-side memory management', 'Blackboard, scratchpad, and attributes stored in agent_sessions table, updated per iteration', 2, 'backend', 'p0', 'backlog', 5, ARRAY['Blackboard entries persist across iterations', 'Scratchpad enforces 50KB limit', 'Attributes stored with metadata']),
('R2-004', 'Build loop detection service', 'Port the 4-level detection algorithm to a backend service', 2, 'backend', 'p1', 'backlog', 3, ARRAY['Detects exact repetition', 'Detects tool call patterns', 'Injects interventions into agent context']),
('R2-005', 'Build secure tool dispatcher', 'Central tool execution service that routes tool calls to appropriate handlers', 2, 'backend', 'p0', 'backlog', 5, ARRAY['All 36 tools dispatchable', 'Unknown tools rejected', 'Results returned in consistent format']),

-- Phase 3: Tool Ecosystem
('R3-001', 'Implement web search tools (Brave, Google)', 'Secure search API integrations with rate limiting', 3, 'backend', 'p0', 'backlog', 3, ARRAY['Brave search returns results', 'Google search returns results', 'Rate limited per user']),
('R3-002', 'Implement web scraping tool (secure)', 'Content extraction WITHOUT browser spoofing, with SSRF protections', 3, 'backend', 'p0', 'backlog', 5, ARRAY['Fetches public web pages', 'Blocks private IP ranges', 'Identifies as GoA bot', 'Respects robots.txt']),
('R3-003', 'Implement GitHub tools', 'Repository browsing and file reading with optional token auth', 3, 'backend', 'p1', 'backlog', 3, ARRAY['Can list repo files', 'Can read file contents', 'Handles private repos with token']),
('R3-004', 'Implement document tools (PDF, OCR, ZIP)', 'Server-side document processing using Node.js libraries', 3, 'backend', 'p1', 'backlog', 5, ARRAY['PDF text extraction works', 'OCR returns text from images', 'ZIP listing and extraction works']),
('R3-005', 'Implement API proxy tool (restricted)', 'HTTP proxy with URL allowlisting and private IP blocking', 3, 'backend', 'p1', 'backlog', 3, ARRAY['GET/POST to allowed URLs works', 'Private IPs blocked', 'Request size limited']),
('R3-006', 'Implement database tool (parameterized)', 'SQL execution with parameterized queries and connection allowlisting', 3, 'backend', 'p1', 'backlog', 5, ARRAY['Read queries execute correctly', 'Write queries require explicit flag', 'Connection strings validated against allowlist']),
('R3-007', 'Implement generation tools (Image, TTS)', 'Gemini image generation and ElevenLabs TTS integrations', 3, 'backend', 'p2', 'backlog', 3, ARRAY['Image generation returns base64', 'TTS returns audio content']),
('R3-008', 'Implement utility and communication tools', 'Time, weather, email sending with recipient restrictions', 3, 'backend', 'p2', 'backlog', 3, ARRAY['Time returns correct timezone data', 'Email sends to allowed recipients only']),

-- Phase 4: Frontend Shell & Free Agent UI
('R4-001', 'Initialize Vue 3 + Vite + Pinia + Alberta DS', 'Frontend scaffold with routing, state management, and GoA design system', 4, 'frontend', 'p0', 'backlog', 3, ARRAY['Vue app builds and serves', 'Alberta DS components render correctly', 'Router navigates between views']),
('R4-002', 'Build authentication flow UI', 'Login page, SSO redirect, user profile display, logout', 4, 'frontend', 'p0', 'backlog', 3, ARRAY['Login redirects to Entra ID', 'Authenticated user sees their name/ministry', 'Logout clears session']),
('R4-003', 'Build Free Agent layout and task panel', 'Main agent interface: task input, model selection, controls, file upload', 4, 'frontend', 'p0', 'backlog', 5, ARRAY['User can enter a prompt', 'Model dropdown populated from registry', 'Start/Stop/Reset controls work']),
('R4-004', 'Implement SSE streaming for agent progress', 'Consume Server-Sent Events to show real-time agent execution', 4, 'frontend', 'p0', 'backlog', 5, ARRAY['Iteration updates appear in real-time', 'Tool calls show as they execute', 'Blackboard updates live']),
('R4-005', 'Build memory viewers (Blackboard, Scratchpad, Artifacts)', 'Tabbed panel showing agent memory state fetched from backend', 4, 'frontend', 'p1', 'backlog', 5, ARRAY['Blackboard shows categorized entries', 'Scratchpad shows current content', 'Artifacts are downloadable']),
('R4-006', 'Build Free Agent canvas (Vue Flow)', 'Visual execution graph showing agent nodes, tool calls, and artifacts', 4, 'frontend', 'p2', 'backlog', 5, ARRAY['Canvas shows execution flow', 'Nodes appear as tools are called', 'Minimap works']),

-- Phase 5: Workflow Canvas
('R5-001', 'Integrate Vue Flow and build custom nodes', 'Agent, Function, Tool, and Note node components for the workflow canvas', 5, 'frontend', 'p0', 'backlog', 8, ARRAY['All 4 node types render', 'Drag and drop works', 'Connections between nodes work']),
('R5-002', 'Build workflow sidebar (agent/function library)', 'Draggable library of agents and 40+ function types', 5, 'frontend', 'p0', 'backlog', 5, ARRAY['Agent templates listed', 'Function library searchable', 'Drag to canvas creates node']),
('R5-003', 'Build properties panel', 'Node configuration editor (prompts, parameters, model selection)', 5, 'frontend', 'p1', 'backlog', 5, ARRAY['Selecting a node shows its properties', 'Editing properties updates the node', 'Model override per-node works']),
('R5-004', 'Implement workflow execution engine', 'Backend API that executes workflow stages sequentially with streaming', 5, 'backend', 'p0', 'backlog', 8, ARRAY['Workflow executes stage by stage', 'Agent outputs stream to UI', 'Function nodes execute deterministically']),
('R5-005', 'Implement workflow save/load', 'CRUD API for persisting workflows to database', 5, 'backend', 'p1', 'backlog', 3, ARRAY['Save workflow stores canvas_data', 'Load workflow restores full state', 'List shows user workflows']),

-- Phase 6: Testing, Polish & Deployment
('R6-001', 'Write backend unit tests', 'Vitest tests for all routes, services, and middleware (80%+ coverage)', 6, 'testing', 'p1', 'backlog', 8, ARRAY['All critical paths tested', 'Coverage report generated', 'Tests pass in CI']),
('R6-002', 'Write frontend component tests', 'Vue Test Utils tests for key components and Pinia stores', 6, 'testing', 'p1', 'backlog', 5, ARRAY['Key components have tests', 'Store actions tested']),
('R6-003', 'Accessibility audit and fixes', 'WCAG 2.1 AA compliance: contrast, labels, keyboard nav, screen reader', 6, 'ux', 'p1', 'backlog', 5, ARRAY['axe-core reports zero critical issues', 'All interactive elements keyboard accessible', 'Screen reader navigable']),
('R6-004', 'Deploy to Nexus', 'Frontend on 5173, backend on 3000, SSO callbacks configured', 6, 'deployment', 'p0', 'backlog', 3, ARRAY['App accessible via Nexus URL', 'SSO login works end-to-end', 'Database connected']),
('R6-005', 'Prepare SOAR/STRA documentation', 'Security assessment package for Authority to Operate', 6, 'documentation', 'p0', 'backlog', 5, ARRAY['Threat model complete', 'Controls matrix mapped', 'Data flow diagrams produced'])

ON CONFLICT (task_id) DO NOTHING;

-- ============================================================================
-- SEED DATA: Vulnerabilities (why rebuild was chosen)
-- ============================================================================

INSERT INTO cohen_mcleod.vulnerabilities (vuln_id, title, category, severity, description, impact, how_rebuild_addresses, status)
VALUES
('V-001', 'Zero Authentication', 'authentication', 'critical', 'No authentication on any endpoint. All 22 edge functions publicly accessible.', 'Complete unauthorized access to all functionality', 'Rebuild has Entra ID SSO from first commit. No route is accessible without valid JWT.', 'addressed_by_rebuild'),
('V-002', 'Client-Side Orchestration', 'architecture', 'critical', 'Core agent logic, memory, and secrets managed in browser JavaScript.', 'Trivial bypass of all safety controls by modifying client code', 'Rebuild moves all orchestration to Node.js backend. Frontend is a pure presentation layer.', 'addressed_by_rebuild'),
('V-003', 'Open CORS on All Endpoints', 'configuration', 'high', 'Access-Control-Allow-Origin: * on all 22 edge functions.', 'Any website can call the API, enabling CSRF and data exfiltration', 'Rebuild restricts CORS to the specific Nexus frontend domain only.', 'addressed_by_rebuild'),
('V-004', 'Client-Side Secret Storage', 'cryptography', 'high', 'API keys stored in plaintext in browser sessionStorage and sent in request payloads.', 'XSS or network interception exposes all configured API keys', 'Rebuild stores secrets server-side only. Frontend never sees or transmits API keys.', 'addressed_by_rebuild'),
('V-005', 'Open Scraping Proxy with Browser Spoofing', 'injection', 'high', 'web-scrape endpoint is unauthenticated, spoofs browser headers, and can target any URL.', 'SSRF attacks against internal networks, abuse for scraping attacks', 'Rebuild implements transparent bot identification, SSRF protections, and rate limiting.', 'addressed_by_rebuild'),
('V-006', 'Arbitrary SQL Execution', 'injection', 'high', 'external-db accepts raw SQL and arbitrary connection strings without validation.', 'Full database compromise, data exfiltration from any reachable PostgreSQL', 'Rebuild enforces parameterized queries and connection string allowlisting.', 'addressed_by_rebuild'),
('V-007', 'No PII Controls Before LLM Calls', 'privacy', 'high', 'User content sent directly to external AI providers without scanning.', 'Protected B personal information disclosed to foreign AI providers', 'Rebuild includes PII detection middleware that scans all outbound LLM content.', 'addressed_by_rebuild'),
('V-008', 'No Audit Trail', 'logging', 'high', 'Only console.log exists. No structured logging, no user attribution.', 'Cannot detect unauthorized access or investigate incidents', 'Rebuild logs every action to immutable audit_log table with user attribution.', 'addressed_by_rebuild'),
('V-009', 'No Rate Limiting', 'availability', 'high', 'No rate limiting on any endpoint. Vulnerable to cost attacks on LLM APIs.', 'Excessive API costs, denial of service', 'Rebuild implements per-user, per-endpoint rate limiting with token budgets.', 'addressed_by_rebuild'),
('V-010', 'Debug Data in API Responses', 'exposure', 'medium', 'Full system prompts and raw LLM responses returned in API responses.', 'Exposure of prompt engineering and internal architecture', 'Rebuild returns only necessary data. Debug info stays in server-side logs.', 'addressed_by_rebuild')

ON CONFLICT (vuln_id) DO NOTHING;

-- ============================================================================
-- SEED DATA: Privacy Controls
-- ============================================================================

INSERT INTO cohen_mcleod.privacy_controls (control_id, title, category, classification_level, description, implementation_approach, build_phase, status)
VALUES
('PC-001', 'PII Detection - Health Numbers & SINs', 'pii_detection', 'protected_b', 'Detect Alberta Health Care numbers and SINs before LLM calls', 'Backend middleware with regex patterns + Luhn validation. Blocks request and logs detection.', 1, 'planned'),
('PC-002', 'PII Detection - Credentials & Secrets', 'pii_detection', 'protected_a', 'Detect API keys, tokens, and passwords in content', 'Pattern matching for known key formats (sk-, AIza, Bearer). Always blocks.', 1, 'planned'),
('PC-003', 'Ministry Data Segmentation', 'segmentation', 'protected_b', 'Isolate data by ministry using Entra ID group claims', 'Extract ministry from AIM-G-{MINISTRY} groups in JWT. Filter all queries by ministry_id.', 1, 'planned'),
('PC-004', 'Immutable Audit Trail', 'audit', 'protected_b', 'Log all actions with user identity and timestamp', 'INSERT-only audit_log table. App DB user has no UPDATE/DELETE on this table.', 1, 'planned'),
('PC-005', 'Server-Side Secret Management', 'encryption', 'protected_b', 'Store and inject API keys server-side only', 'Environment variables for provider keys. Per-user tool secrets encrypted in DB with AES-256.', 1, 'planned'),
('PC-006', 'Data Classification Tagging', 'data_classification', 'protected_b', 'Tag workflows and sessions with classification level', 'Classification field on workflows and sessions. Enforces handling rules per level.', 2, 'planned'),
('PC-007', 'LLM Data Residency Control', 'access_control', 'protected_b', 'Route Protected B content only to Canadian-region AI services', 'Model registry includes data_residency field. Backend rejects non-Canadian models for Protected B.', 2, 'planned'),
('PC-008', 'Export Controls', 'export_control', 'protected_b', 'Restrict data export by classification and role', 'Export endpoints check classification vs user role. Protected B: admin only.', 4, 'planned'),
('PC-009', 'Data Retention Automation', 'retention', 'protected_a', 'Automated cleanup based on retention schedule', 'Scheduled job removes expired sessions. Unclassified: 90d, PA: 1yr, PB: 3yr.', 6, 'planned'),
('PC-010', 'User Consent for AI Processing', 'consent', 'protected_a', 'Require acknowledgment before AI processes user content', 'Consent modal on first use. Record stored in DB with timestamp.', 4, 'planned')

ON CONFLICT (control_id) DO NOTHING;

-- ============================================================================
-- SEED DATA: Migration (Build Steps)
-- ============================================================================

INSERT INTO cohen_mcleod.migration (phase, phase_title, step_number, task_title, description, effort_points, risk_level, status)
VALUES
-- Phase 1
(1, 'Foundation & Security Core', '1.1', 'Initialize monorepo', 'pnpm workspace with frontend/, backend/, shared/ and root TypeScript config', 2, 'low', 'planned'),
(1, 'Foundation & Security Core', '1.2', 'Express backend skeleton', 'TypeScript Express app with health check, error handling, and middleware structure', 3, 'low', 'planned'),
(1, 'Foundation & Security Core', '1.3', 'Entra ID SSO integration', 'OIDC client, login/callback/logout routes, JWT validation middleware', 5, 'high', 'planned'),
(1, 'Foundation & Security Core', '1.4', 'Database schema creation', 'All tables in cohen_mcleod schema, idempotent migrations', 5, 'medium', 'planned'),
(1, 'Foundation & Security Core', '1.5', 'RBAC and ministry middleware', 'Role checking and ministry-scoped query filtering on all routes', 3, 'medium', 'planned'),
(1, 'Foundation & Security Core', '1.6', 'PII detection service', 'Regex scanner with configurable patterns, pre-LLM interception', 5, 'medium', 'planned'),
(1, 'Foundation & Security Core', '1.7', 'Audit logging framework', 'Structured audit service writing to audit_log table', 3, 'low', 'planned'),

-- Phase 2
(2, 'Backend Orchestration Engine', '2.1', 'LLM provider factory', 'Model registry-driven provider abstraction supporting Vertex AI Claude', 5, 'medium', 'planned'),
(2, 'Backend Orchestration Engine', '2.2', 'Server-side iteration loop', 'Core agent execution: prompt build, LLM call, parse, tool dispatch, memory update', 8, 'high', 'planned'),
(2, 'Backend Orchestration Engine', '2.3', 'Server-side memory management', 'Blackboard/scratchpad/attributes persisted in PostgreSQL per session', 5, 'medium', 'planned'),
(2, 'Backend Orchestration Engine', '2.4', 'Loop detection service', 'Multi-level detection algorithm ported from spec app logic', 3, 'low', 'planned'),
(2, 'Backend Orchestration Engine', '2.5', 'Tool execution dispatcher', 'Central routing of tool calls to handler functions with consistent interface', 5, 'medium', 'planned'),
(2, 'Backend Orchestration Engine', '2.6', 'SSE streaming endpoint', 'Server-Sent Events endpoint for real-time agent progress to frontend', 3, 'medium', 'planned'),

-- Phase 3
(3, 'Tool Ecosystem', '3.1', 'Web search tools', 'Brave Search and Google Custom Search integrations with rate limiting', 3, 'low', 'planned'),
(3, 'Tool Ecosystem', '3.2', 'Secure web scraping', 'Content extraction with SSRF protections, transparent bot ID, no spoofing', 5, 'medium', 'planned'),
(3, 'Tool Ecosystem', '3.3', 'GitHub integration', 'Repository browsing and file reading', 3, 'low', 'planned'),
(3, 'Tool Ecosystem', '3.4', 'Document processing tools', 'PDF extraction, OCR, ZIP handling using Node.js libraries', 5, 'low', 'planned'),
(3, 'Tool Ecosystem', '3.5', 'Restricted API proxy', 'HTTP proxy with URL allowlist and private IP blocking', 3, 'medium', 'planned'),
(3, 'Tool Ecosystem', '3.6', 'Parameterized database tool', 'SQL execution with strict parameterization and connection allowlist', 5, 'high', 'planned'),
(3, 'Tool Ecosystem', '3.7', 'Generation tools', 'Image generation and TTS integrations', 3, 'low', 'planned'),
(3, 'Tool Ecosystem', '3.8', 'Utility and communication tools', 'Time, weather, restricted email sending', 3, 'low', 'planned'),

-- Phase 4
(4, 'Frontend Shell & Free Agent UI', '4.1', 'Vue 3 scaffold with Alberta DS', 'Vite + Vue 3 + Pinia + Vue Router + Alberta Design System', 3, 'low', 'planned'),
(4, 'Frontend Shell & Free Agent UI', '4.2', 'Authentication UI', 'Login flow, user profile, logout', 3, 'low', 'planned'),
(4, 'Frontend Shell & Free Agent UI', '4.3', 'Free Agent task panel', 'Prompt input, model selection, controls, file upload', 5, 'medium', 'planned'),
(4, 'Frontend Shell & Free Agent UI', '4.4', 'SSE streaming consumer', 'Real-time display of agent execution progress', 5, 'medium', 'planned'),
(4, 'Frontend Shell & Free Agent UI', '4.5', 'Memory viewers', 'Blackboard, scratchpad, artifacts tabbed panels', 5, 'low', 'planned'),
(4, 'Frontend Shell & Free Agent UI', '4.6', 'Free Agent execution canvas', 'Vue Flow visualization of agent execution graph', 5, 'medium', 'planned'),

-- Phase 5
(5, 'Workflow Canvas', '5.1', 'Vue Flow integration with custom nodes', 'Agent, Function, Tool, Note node components', 8, 'high', 'planned'),
(5, 'Workflow Canvas', '5.2', 'Workflow sidebar library', 'Draggable agent templates and function catalog', 5, 'medium', 'planned'),
(5, 'Workflow Canvas', '5.3', 'Properties panel', 'Node configuration editor', 5, 'medium', 'planned'),
(5, 'Workflow Canvas', '5.4', 'Workflow execution engine', 'Backend sequential stage execution with streaming', 8, 'high', 'planned'),
(5, 'Workflow Canvas', '5.5', 'Workflow persistence', 'Save/load/list/delete API and UI', 3, 'low', 'planned'),

-- Phase 6
(6, 'Testing, Polish & Deployment', '6.1', 'Backend test suite', 'Vitest unit tests for routes, services, middleware', 8, 'low', 'planned'),
(6, 'Testing, Polish & Deployment', '6.2', 'Frontend test suite', 'Vue Test Utils component and store tests', 5, 'low', 'planned'),
(6, 'Testing, Polish & Deployment', '6.3', 'Accessibility audit', 'WCAG 2.1 AA compliance fixes', 5, 'low', 'planned'),
(6, 'Testing, Polish & Deployment', '6.4', 'Nexus deployment', 'Frontend 5173, backend 3000, SSO callbacks, env vars', 3, 'medium', 'planned'),
(6, 'Testing, Polish & Deployment', '6.5', 'SOAR/STRA package', 'Security assessment documentation for Authority to Operate', 5, 'medium', 'planned')

ON CONFLICT DO NOTHING;

-- ============================================================================
-- ============================================================================
-- STREAM A — User Memory (Identity, SSO & per-user persistence)
-- Idempotent and additive. Safe to re-run.
-- ============================================================================

-- Per-user preferences (one row per user)
CREATE TABLE IF NOT EXISTS cohen_mcleod.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES cohen_mcleod.users(id) ON DELETE CASCADE,
    default_model_id TEXT,
    default_classification TEXT,
    theme TEXT DEFAULT 'light',
    notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Saved prompts (per-user; may be shared with same-ministry users when is_public)
CREATE TABLE IF NOT EXISTS cohen_mcleod.saved_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id) ON DELETE CASCADE,
    ministry_code TEXT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    tags TEXT[],
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_prompts_user     ON cohen_mcleod.saved_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_prompts_ministry ON cohen_mcleod.saved_prompts(ministry_code);

DROP TRIGGER IF EXISTS trg_saved_prompts_updated ON cohen_mcleod.saved_prompts;
CREATE TRIGGER trg_saved_prompts_updated BEFORE UPDATE ON cohen_mcleod.saved_prompts
  FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

-- Workflow favorites (composite PK; cascading cleanup on user/workflow delete)
CREATE TABLE IF NOT EXISTS cohen_mcleod.workflow_favorites (
    user_id      UUID NOT NULL REFERENCES cohen_mcleod.users(id)     ON DELETE CASCADE,
    workflow_id  UUID NOT NULL REFERENCES cohen_mcleod.workflows(id) ON DELETE CASCADE,
    favorited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_favorites_user ON cohen_mcleod.workflow_favorites(user_id);

-- ============================================================================
-- WORKFLOW CANVAS TABLES (Stream C)
-- Idempotent and additive. Safe to re-run.
-- ============================================================================

-- Workflow Versions (snapshot per canvas_data change)
CREATE TABLE IF NOT EXISTS cohen_mcleod.workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES cohen_mcleod.workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    canvas_data JSONB NOT NULL,
    created_by UUID NOT NULL REFERENCES cohen_mcleod.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_wf_versions_workflow ON cohen_mcleod.workflow_versions(workflow_id);

-- Workflow Executions (per-run record with stage outputs)
CREATE TABLE IF NOT EXISTS cohen_mcleod.workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES cohen_mcleod.workflows(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id),
    classification TEXT NOT NULL DEFAULT 'unclassified',
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','error','aborted')),
    stage_results JSONB NOT NULL DEFAULT '[]',
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wf_executions_user ON cohen_mcleod.workflow_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_wf_executions_workflow ON cohen_mcleod.workflow_executions(workflow_id);

-- Artifacts: allow workflow-execution-owned artifacts (in addition to session-owned)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'cohen_mcleod' AND table_name = 'artifacts'
          AND column_name = 'session_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE cohen_mcleod.artifacts ALTER COLUMN session_id DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE cohen_mcleod.artifacts
    ADD COLUMN IF NOT EXISTS workflow_execution_id UUID REFERENCES cohen_mcleod.workflow_executions(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'cohen_mcleod' AND table_name = 'artifacts'
          AND constraint_name = 'artifacts_owner_present'
    ) THEN
        ALTER TABLE cohen_mcleod.artifacts
            ADD CONSTRAINT artifacts_owner_present
            CHECK (session_id IS NOT NULL OR workflow_execution_id IS NOT NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_artifacts_workflow_execution ON cohen_mcleod.artifacts(workflow_execution_id);

-- ============================================================================
-- STREAM F: COMPLIANCE, PRIVACY HARDENING & DEPLOYMENT
-- ============================================================================
-- Adds:
--   - pgcrypto extension (symmetric encryption for user secrets)
--   - cohen_mcleod.user_secrets (per-user encrypted secret store)
--   - cohen_mcleod.retention_policy (classification-aware retention schedule)
-- All blocks are idempotent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Per-user encrypted secret store.
-- Encrypted client-side in backend/src/services/secretsVault.ts using
-- pgp_sym_encrypt with SECRETS_VAULT_KEY (env). Plaintext never written.
CREATE TABLE IF NOT EXISTS cohen_mcleod.user_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, label)
);

CREATE INDEX IF NOT EXISTS idx_user_secrets_user ON cohen_mcleod.user_secrets(user_id);

DROP TRIGGER IF EXISTS trg_user_secrets_updated ON cohen_mcleod.user_secrets;
CREATE TRIGGER trg_user_secrets_updated BEFORE UPDATE ON cohen_mcleod.user_secrets
    FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

-- Classification-aware retention schedule.
-- Consumed by backend/src/services/retentionJob.ts.
-- sessions_days, artifacts_days are hard-delete windows.
-- audit_log_days is the anonymization window (rows kept for compliance counts).
CREATE TABLE IF NOT EXISTS cohen_mcleod.retention_policy (
    classification TEXT PRIMARY KEY,
    sessions_days INTEGER NOT NULL,
    artifacts_days INTEGER NOT NULL,
    audit_log_days INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cohen_mcleod.retention_policy (classification, sessions_days, artifacts_days, audit_log_days) VALUES
  ('unclassified', 90,   90,   365),
  ('protected_a',  365,  365,  1095),
  ('protected_b',  1095, 1095, 2555)
ON CONFLICT (classification) DO NOTHING;

DROP TRIGGER IF EXISTS trg_retention_policy_updated ON cohen_mcleod.retention_policy;
CREATE TRIGGER trg_retention_policy_updated BEFORE UPDATE ON cohen_mcleod.retention_policy
    FOR EACH ROW EXECUTE FUNCTION cohen_mcleod.update_timestamp();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT 'features' as tbl, count(*) FROM cohen_mcleod.features
-- UNION ALL SELECT 'vulnerabilities', count(*) FROM cohen_mcleod.vulnerabilities
-- UNION ALL SELECT 'migration', count(*) FROM cohen_mcleod.migration
-- UNION ALL SELECT 'plan', count(*) FROM cohen_mcleod.plan
-- UNION ALL SELECT 'privacy_controls', count(*) FROM cohen_mcleod.privacy_controls
-- UNION ALL SELECT 'user_preferences', count(*) FROM cohen_mcleod.user_preferences
-- UNION ALL SELECT 'saved_prompts', count(*) FROM cohen_mcleod.saved_prompts
-- UNION ALL SELECT 'workflow_favorites', count(*) FROM cohen_mcleod.workflow_favorites
-- UNION ALL SELECT 'user_secrets', count(*) FROM cohen_mcleod.user_secrets
-- UNION ALL SELECT 'retention_policy', count(*) FROM cohen_mcleod.retention_policy;

-- ============================================================================
-- STREAM D: Model registry seed (idempotent)
-- ============================================================================
INSERT INTO cohen_mcleod.model_registry
  (model_id, display_name, provider, api_model_name, max_output_tokens,
   supports_streaming, supports_tools, data_residency, max_classification, is_active)
VALUES
  ('claude-opus-4-7','Claude Opus 4.7 (Vertex AI)','vertex_ai','claude-opus-4-7',16384,true,true,'canada','protected_b',true),
  ('claude-sonnet-4-6','Claude Sonnet 4.6 (Vertex AI)','vertex_ai','claude-sonnet-4-6',16384,true,true,'canada','protected_b',true),
  ('claude-haiku-4-5','Claude Haiku 4.5 (Vertex AI)','vertex_ai','claude-haiku-4-5-20251001',8192,true,true,'canada','protected_a',true),
  ('gemini-2.5-flash','Gemini 2.5 Flash','google','gemini-2.5-flash-preview-05-20',8192,true,true,'us','unclassified',true)
ON CONFLICT (model_id) DO NOTHING;

-- ============================================================================
-- SEED DATA: Features (exercise requirement — maps the spec app's capabilities
--                     to what the rebuild ports / replaces / drops)
-- ============================================================================
-- Spec app source: https://github.com/developmentation/agent-builder-console
-- Each row records intent only; no code from the spec was copied.
-- A unique index on `name` makes the bulk INSERT idempotent across re-runs.

CREATE UNIQUE INDEX IF NOT EXISTS uq_features_name ON cohen_mcleod.features(name);

INSERT INTO cohen_mcleod.features
  (name, category, subcategory, description, source_file, mode, status, build_priority, build_phase, notes)
VALUES
-- ----- Screens / top-level views (spec → rebuild) -----
('login_screen', 'screen', 'auth', 'SSO entry page; redirects unauthenticated users to Entra ID', 'frontend/src/views/LoginView.vue', 'shared', 'active', 'critical', 1, 'Spec had no auth at all'),
('profile_screen', 'screen', 'auth', 'Identity + ministry display + saved-prompt management', 'frontend/src/views/ProfileView.vue', 'shared', 'active', 'high', 1, 'New surface — spec had no user accounts'),
('free_agent_screen', 'screen', 'agent', 'Three-panel Free Agent workbench (task / canvas / memory)', 'frontend/src/views/FreeAgentView.vue', 'freeAgent', 'active', 'critical', 4, NULL),
('workflow_canvas_screen', 'screen', 'workflow', 'Visual Vue Flow editor for chaining Agent/Function/Tool/Note nodes', 'frontend/src/views/WorkflowView.vue', 'workflow', 'active', 'critical', 5, NULL),
('workflow_list_screen', 'screen', 'workflow', 'List of saved workflows with search + ministry scoping', 'frontend/src/views/WorkflowListView.vue', 'workflow', 'active', 'high', 5, NULL),
('admin_screen', 'screen', 'admin', 'Audit / PII / model-registry / session inspector tabs', 'frontend/src/views/AdminView.vue', 'shared', 'active', 'high', 6, 'Stream F'),

-- ----- Core Free Agent UI components -----
('task_panel', 'component', 'freeAgent', 'Prompt + model + classification + max iterations input', 'frontend/src/components/freeAgent/TaskPanel.vue', 'freeAgent', 'active', 'critical', 4, NULL),
('control_bar', 'component', 'freeAgent', 'Stop / continue / interject + iteration counter', 'frontend/src/components/freeAgent/ControlBar.vue', 'freeAgent', 'active', 'critical', 4, NULL),
('iteration_timeline', 'component', 'freeAgent', 'Per-iteration cards with status, thinking, and tool calls', 'frontend/src/components/freeAgent/IterationTimeline.vue', 'freeAgent', 'active', 'critical', 4, NULL),
('blackboard_viewer', 'component', 'freeAgent', 'Categorized entries with iteration badges + search', 'frontend/src/components/freeAgent/BlackboardViewer.vue', 'freeAgent', 'active', 'high', 4, NULL),
('scratchpad_viewer', 'component', 'freeAgent', 'Markdown-rendered scratchpad (DOMPurify-sanitized)', 'frontend/src/components/freeAgent/ScratchpadViewer.vue', 'freeAgent', 'active', 'high', 4, NULL),
('artifacts_panel', 'component', 'freeAgent', 'Artifact list with type filtering + download', 'frontend/src/components/freeAgent/ArtifactsPanel.vue', 'freeAgent', 'active', 'high', 4, NULL),
('prompt_customizer', 'component', 'freeAgent', 'Section enable/disable + content edit modal for the system prompt', 'frontend/src/components/freeAgent/PromptCustomizer.vue', 'freeAgent', 'active', 'medium', 4, NULL),
('agent_canvas', 'component', 'freeAgent', 'Vue Flow visualization of execution graph (live as iterations stream)', 'frontend/src/components/freeAgent/AgentCanvas.vue', 'freeAgent', 'active', 'medium', 4, NULL),
('interjection_modal', 'component', 'freeAgent', '"Inject guidance" modal — sends user message into a running iteration', 'frontend/src/components/freeAgent/InterjectionModal.vue', 'freeAgent', 'active', 'medium', 4, NULL),
('final_report_panel', 'component', 'freeAgent', 'Renders final_report from a completed session', 'frontend/src/components/freeAgent/FinalReportPanel.vue', 'freeAgent', 'active', 'high', 4, NULL),

-- ----- Workflow canvas components -----
('workflow_canvas', 'component', 'workflow', 'Vue Flow wrapper hosting the editor', 'frontend/src/components/workflow/WorkflowCanvas.vue', 'workflow', 'active', 'critical', 5, NULL),
('workflow_sidebar', 'component', 'workflow', 'Draggable agent templates + function catalog + node library', 'frontend/src/components/workflow/WorkflowSidebar.vue', 'workflow', 'active', 'high', 5, NULL),
('workflow_properties_panel', 'component', 'workflow', 'Dynamic form editor for the selected node', 'frontend/src/components/workflow/PropertiesPanel.vue', 'workflow', 'active', 'high', 5, NULL),
('workflow_toolbar', 'component', 'workflow', 'Save / load / run / classification dropdown', 'frontend/src/components/workflow/WorkflowToolbar.vue', 'workflow', 'active', 'high', 5, NULL),
('workflow_execution_panel', 'component', 'workflow', 'Live execution results drawer — per-stage status, timing, output (markdown/JSON), and PII-blocked counts', 'frontend/src/components/workflow/ExecutionPanel.vue', 'workflow', 'active', 'high', 5, 'Closes the Stream C gap where stage outputs were captured but never displayed'),
('node_agent', 'component', 'workflow', 'Custom Agent node (system prompt + model + tools)', 'frontend/src/components/workflow/nodes/AgentNode.vue', 'workflow', 'active', 'critical', 5, NULL),
('node_function', 'component', 'workflow', 'Custom Function node (deterministic transform from functionRegistry)', 'frontend/src/components/workflow/nodes/FunctionNode.vue', 'workflow', 'active', 'critical', 5, NULL),
('node_tool', 'component', 'workflow', 'Custom Tool node — delegates to toolDispatcher', 'frontend/src/components/workflow/nodes/ToolNode.vue', 'workflow', 'active', 'critical', 5, NULL),
('node_note', 'component', 'workflow', 'Custom Note node (commentary only; skipped at execution)', 'frontend/src/components/workflow/nodes/NoteNode.vue', 'workflow', 'active', 'low', 5, NULL),

-- ----- Frontend state stores -----
('store_auth', 'component', 'state', 'Pinia auth store — user, login(), logout(), fetchMe()', 'frontend/src/stores/auth.ts', 'shared', 'active', 'critical', 1, NULL),
('store_agent_session', 'component', 'state', 'Pinia store — session lifecycle + SSE event reducer', 'frontend/src/stores/agentSession.ts', 'freeAgent', 'active', 'critical', 4, NULL),
('store_workflow', 'component', 'state', 'Pinia store — current workflow + saved list + execution log', 'frontend/src/stores/workflow.ts', 'workflow', 'active', 'critical', 5, NULL),
('store_user_memory', 'component', 'state', 'Pinia store — saved prompts, favorite workflows, recent sessions', 'frontend/src/stores/userMemory.ts', 'shared', 'active', 'high', 1, NULL),
('store_models', 'component', 'state', 'Pinia store — cached /api/agent/models registry', 'frontend/src/stores/models.ts', 'shared', 'active', 'high', 4, NULL),

-- ----- Composables / utilities (rebuild-only) -----
('composable_sse_stream', 'utility', 'streaming', 'POST + ReadableStream consumer for SSE (EventSource cannot POST JSON bodies)', 'frontend/src/composables/useSSEStream.ts', 'shared', 'active', 'critical', 4, NULL),
('composable_api_fetch', 'utility', 'http', 'fetch wrapper with credentials + JSON shaping + ApiError thrown on non-2xx', 'frontend/src/composables/useApiFetch.ts', 'shared', 'active', 'high', 1, NULL),
('composable_markdown', 'utility', 'rendering', 'marked + DOMPurify pipeline — every v-html call must go through this', 'frontend/src/composables/useMarkdown.ts', 'shared', 'active', 'high', 4, 'Defense-in-depth against LLM-emitted XSS'),
('composable_toast', 'utility', 'ui', 'Global lightweight toast queue with TTL auto-dismiss', 'frontend/src/composables/useToast.ts', 'shared', 'active', 'medium', 4, NULL),
('composable_auth_guard', 'utility', 'auth', 'Router guard hook — redirects unauthenticated users to /login', 'frontend/src/composables/useAuthGuard.ts', 'shared', 'active', 'critical', 1, NULL),
('composable_focus_trap', 'utility', 'a11y', 'Tab-cycling focus trap for modals (a11y baseline)', 'frontend/src/composables/useFocusTrap.ts', 'shared', 'active', 'medium', 4, 'WCAG 2.1 AA'),

-- ----- Backend endpoints (Free Agent) -----
('endpoint_agent_create', 'endpoint', 'agent', 'POST /api/agent/sessions — create a new session', 'backend/src/routes/agent.ts', 'backend', 'active', 'critical', 2, NULL),
('endpoint_agent_start_sse', 'endpoint', 'agent', 'POST /api/agent/sessions/:id/start — open SSE stream and run the iteration loop', 'backend/src/routes/agent.ts', 'backend', 'active', 'critical', 2, NULL),
('endpoint_agent_stop', 'endpoint', 'agent', 'POST /api/agent/sessions/:id/stop — abort an in-flight session', 'backend/src/routes/agent.ts', 'backend', 'active', 'critical', 2, NULL),
('endpoint_agent_interject', 'endpoint', 'agent', 'POST /api/agent/sessions/:id/interject — inject user guidance mid-run', 'backend/src/routes/agent.ts', 'backend', 'active', 'high', 2, NULL),
('endpoint_agent_get', 'endpoint', 'agent', 'GET /api/agent/sessions/:id — fetch session state + memory snapshot', 'backend/src/routes/agent.ts', 'backend', 'active', 'critical', 2, NULL),
('endpoint_agent_models', 'endpoint', 'agent', 'GET /api/agent/models — return approved model registry rows', 'backend/src/routes/agent.ts', 'backend', 'active', 'critical', 2, NULL),
('endpoint_agent_prompt_template', 'endpoint', 'agent', 'GET /api/agent/prompt-template — sections for the prompt customizer', 'backend/src/routes/agent.ts', 'backend', 'active', 'medium', 2, NULL),

-- ----- Backend endpoints (Workflow) -----
('endpoint_workflow_list', 'endpoint', 'workflow', 'GET /api/workflows — list workflows scoped to user/ministry', 'backend/src/routes/workflow.ts', 'backend', 'active', 'critical', 5, NULL),
('endpoint_workflow_crud', 'endpoint', 'workflow', 'POST/GET/PUT/DELETE /api/workflows/:id — CRUD on canvas_data', 'backend/src/routes/workflow.ts', 'backend', 'active', 'critical', 5, NULL),
('endpoint_workflow_execute', 'endpoint', 'workflow', 'POST /api/workflows/:id/execute — run the graph; streams stage progress via SSE', 'backend/src/routes/workflow.ts', 'backend', 'active', 'critical', 5, NULL),

-- ----- Backend endpoints (Auth / User memory) -----
('endpoint_auth_login', 'endpoint', 'auth', 'GET /api/auth/login — PKCE redirect to Entra ID', 'backend/src/routes/auth.ts', 'backend', 'active', 'critical', 1, NULL),
('endpoint_auth_callback', 'endpoint', 'auth', 'GET /api/auth/callback — token exchange + user upsert + session cookie', 'backend/src/routes/auth.ts', 'backend', 'active', 'critical', 1, NULL),
('endpoint_auth_logout', 'endpoint', 'auth', 'POST /api/auth/logout — clear session cookie', 'backend/src/routes/auth.ts', 'backend', 'active', 'critical', 1, NULL),
('endpoint_auth_me', 'endpoint', 'auth', 'GET /api/auth/me — return current AuthUser', 'backend/src/routes/auth.ts', 'backend', 'active', 'critical', 1, NULL),
('endpoint_users_preferences', 'endpoint', 'user', 'GET/PUT /api/users/me/preferences', 'backend/src/routes/users.ts', 'backend', 'active', 'medium', 1, NULL),
('endpoint_users_saved_prompts', 'endpoint', 'user', 'GET/POST/DELETE /api/users/me/saved-prompts', 'backend/src/routes/users.ts', 'backend', 'active', 'medium', 1, NULL),
('endpoint_users_favorites', 'endpoint', 'user', 'GET/POST/DELETE /api/users/me/workflow-favorites', 'backend/src/routes/users.ts', 'backend', 'active', 'medium', 1, NULL),
('endpoint_users_recent', 'endpoint', 'user', 'GET /api/users/me/recent-sessions', 'backend/src/routes/users.ts', 'backend', 'active', 'medium', 1, NULL),

-- ----- Backend endpoints (Admin / Health) -----
('endpoint_health', 'endpoint', 'observability', 'GET /api/health — pool stats + LLM/SMTP/Ent Tools readiness', 'backend/src/routes/health.ts', 'backend', 'active', 'critical', 1, NULL),
('endpoint_admin_audit', 'endpoint', 'admin', 'GET /api/admin/audit — filter + export audit entries', 'backend/src/routes/admin.ts', 'backend', 'active', 'high', 6, NULL),
('endpoint_admin_pii', 'endpoint', 'admin', 'GET /api/admin/pii-detections — forensic PII viewer', 'backend/src/routes/admin.ts', 'backend', 'active', 'high', 6, NULL),
('endpoint_admin_models', 'endpoint', 'admin', 'GET/PATCH /api/admin/models — toggle / re-classify models', 'backend/src/routes/admin.ts', 'backend', 'active', 'high', 6, NULL),
('endpoint_admin_retention_run', 'endpoint', 'admin', 'POST /api/admin/retention/run — manual retention pass', 'backend/src/routes/admin.ts', 'backend', 'active', 'medium', 6, NULL),

-- ----- Backend services -----
('service_llm_provider', 'feature', 'orchestration', 'LLM provider factory — Anthropic via Vertex + Google Gemini', 'backend/src/services/llmProvider.ts', 'backend', 'active', 'critical', 2, NULL),
('service_agent_orchestrator', 'feature', 'orchestration', 'SSE iteration loop with heartbeat / interject / abort', 'backend/src/services/agentOrchestrator.ts', 'backend', 'active', 'critical', 2, NULL),
('service_prompt_builder', 'feature', 'orchestration', 'Dynamic system prompt assembly from template + runtime state', 'backend/src/services/promptBuilder.ts', 'backend', 'active', 'critical', 2, NULL),
('service_loop_detector', 'feature', 'safety', '5-level loop detection with escalating interventions', 'backend/src/services/loopDetector.ts', 'backend', 'active', 'high', 2, NULL),
('service_tool_dispatcher', 'feature', 'orchestration', 'Central tool routing — registration pattern + per-call audit + timeouts', 'backend/src/services/toolDispatcher.ts', 'backend', 'active', 'critical', 2, NULL),
('service_workflow_executor', 'feature', 'orchestration', 'Topological graph walker + stage runner with SSE event emitter', 'backend/src/services/workflowExecutor.ts', 'backend', 'active', 'critical', 5, NULL),
('service_function_registry', 'feature', 'orchestration', 'Deterministic function catalog used by Workflow Function nodes', 'backend/src/services/functionRegistry.ts', 'backend', 'active', 'high', 5, NULL),
('service_pii_detector', 'feature', 'privacy', '12-pattern PII scanner — Luhn-gated SIN/PHN/CC + Alberta-specific IDs', 'backend/src/services/piiDetector.ts', 'backend', 'active', 'critical', 1, 'Defense-in-depth chokepoint before every LLM call'),
('service_audit_logger', 'feature', 'security', 'Immutable audit trail keyed on AuditAction enum', 'backend/src/services/auditLogger.ts', 'backend', 'active', 'critical', 1, NULL),
('service_entra_auth', 'feature', 'security', 'JWKS-cached Entra ID JWT verification + claim→AuthUser mapping', 'backend/src/services/entraAuth.ts', 'backend', 'active', 'critical', 1, NULL),
('service_secrets_vault', 'feature', 'security', 'pgcrypto-backed per-user secret store with key fingerprint logging', 'backend/src/services/secretsVault.ts', 'backend', 'active', 'high', 6, NULL),
('service_retention_job', 'feature', 'privacy', 'Classification-aware scheduled cleanup (90d / 1y / 3y)', 'backend/src/services/retentionJob.ts', 'backend', 'active', 'high', 6, NULL),
('service_logger', 'feature', 'observability', 'Structured JSON logger (info/warn/error/debug)', 'backend/src/services/logger.ts', 'backend', 'active', 'high', 1, NULL),
('service_process_monitor', 'feature', 'observability', 'SIGTERM/SIGINT + unhandled rejection trap with graceful shutdown', 'backend/src/services/processMonitor.ts', 'backend', 'active', 'medium', 1, NULL),
('service_ent_tools_client', 'feature', 'integration', 'Shared HTTP client for GoA Enterprise Tools (Brave + image gen)', 'backend/src/services/entToolsClient.ts', 'backend', 'active', 'high', 3, NULL),

-- ----- Edge tools (the 20 the agent can call) -----
('tool_brave_search', 'feature', 'tools', 'Brave Search — direct or via Ent Tools proxy when configured', 'backend/src/tools/webSearch.ts', 'backend', 'active', 'high', 3, NULL),
('tool_google_search', 'feature', 'tools', 'Google CSE search', 'backend/src/tools/webSearch.ts', 'backend', 'active', 'medium', 3, NULL),
('tool_web_scrape', 'feature', 'tools', 'Content fetch with SSRF protection, no browser spoofing', 'backend/src/tools/webScrape.ts', 'backend', 'active', 'high', 3, NULL),
('tool_github', 'feature', 'tools', 'List + read GitHub repo files (optional GITHUB_TOKEN)', 'backend/src/tools/github.ts', 'backend', 'active', 'medium', 3, NULL),
('tool_pdf', 'feature', 'tools', 'PDF text + metadata extraction (pdf-parse)', 'backend/src/tools/documents.ts', 'backend', 'active', 'medium', 3, NULL),
('tool_zip', 'feature', 'tools', 'ZIP listing + safe per-file extract (adm-zip)', 'backend/src/tools/documents.ts', 'backend', 'active', 'medium', 3, NULL),
('tool_ocr', 'feature', 'tools', 'Tesseract.js image-to-text', 'backend/src/tools/documents.ts', 'backend', 'active', 'low', 3, NULL),
('tool_api_proxy', 'feature', 'tools', 'GET/POST HTTP proxy with SSRF block and optional host allowlist', 'backend/src/tools/apiProxy.ts', 'backend', 'active', 'medium', 3, NULL),
('tool_time_weather', 'feature', 'tools', 'Time and weather utility tools', 'backend/src/tools/utilities.ts', 'backend', 'active', 'low', 3, NULL),
('tool_sql', 'feature', 'tools', 'execute_sql with parameterized queries + connection allowlist', 'backend/src/tools/database.ts', 'backend', 'active', 'medium', 3, NULL),
('tool_image_generation', 'feature', 'tools', 'Image generation via Ent Tools OpenAI or Gemini Image fallback', 'backend/src/tools/generation.ts', 'backend', 'active', 'medium', 3, NULL),
('tool_tts', 'feature', 'tools', 'ElevenLabs text-to-speech with per-user size limits', 'backend/src/tools/generation.ts', 'backend', 'active', 'low', 3, NULL),
('tool_send_email', 'feature', 'tools', 'Nodemailer send with recipient domain allowlist', 'backend/src/tools/communication.ts', 'backend', 'active', 'medium', 3, NULL),

-- ----- Middleware / cross-cutting -----
('middleware_auth', 'feature', 'security', 'Cookie/Bearer → AuthUser with dev mock fallback', 'backend/src/middleware/auth.ts', 'backend', 'active', 'critical', 1, NULL),
('middleware_request_validation', 'feature', 'security', 'Path traversal / XSS / SQLi shape checks + payload limits', 'backend/src/middleware/requestValidation.ts', 'backend', 'active', 'high', 1, NULL),
('middleware_agent_rate_limit', 'feature', 'security', 'Per-user, per-endpoint rate limiting for agent + workflow routes', 'backend/src/middleware/agentRateLimit.ts', 'backend', 'active', 'high', 1, NULL),
('middleware_helmet_cors', 'feature', 'security', 'Helmet CSP/HSTS + tight CORS allowlist (FRONTEND_URL only in prod)', 'backend/src/index.ts', 'backend', 'active', 'critical', 1, NULL),

-- ----- Compliance / docs -----
('doc_threat_model', 'feature', 'compliance', 'STRIDE per component for ATO', 'docs/security/threat_model_stride.md', 'shared', 'active', 'high', 6, NULL),
('doc_data_flow', 'feature', 'compliance', 'Mermaid DFDs for login / free agent / workflow / PII block', 'docs/security/data_flow_diagram.md', 'shared', 'active', 'high', 6, NULL),
('doc_controls_matrix', 'feature', 'compliance', 'Controls vs GoA categorization tied to source files', 'docs/security/controls_matrix.md', 'shared', 'active', 'high', 6, NULL),
('doc_pia', 'feature', 'compliance', 'Privacy Impact Assessment (FOIP s.33, third-party processors, residual risks)', 'docs/privacy/pia.md', 'shared', 'active', 'high', 6, NULL),
('doc_retention_schedule', 'feature', 'compliance', 'Per-classification retention windows', 'docs/privacy/retention_schedule.md', 'shared', 'active', 'high', 6, NULL),
('doc_incident_response', 'feature', 'operations', 'Detect / contain / eradicate / recover playbook', 'docs/operations/incident_response.md', 'shared', 'active', 'medium', 6, NULL),
('doc_key_rotation', 'feature', 'operations', 'SECRETS_VAULT_KEY rotation procedure', 'docs/operations/key_rotation.md', 'shared', 'active', 'medium', 6, NULL),
('doc_observability', 'feature', 'operations', 'Logs / metrics / alerts / manual queries', 'docs/operations/observability.md', 'shared', 'active', 'medium', 6, NULL),
('doc_deploy_nexus', 'feature', 'operations', 'Nexus host runbook + SSO callback registration', 'docs/operations/deployment_nexus.md', 'shared', 'active', 'high', 6, NULL),

-- ----- Spec-app features we intentionally do NOT port -----
('spec_browser_spoofing_dropped', 'feature', 'dropped', 'Spec impersonated browsers in web_scrape — rebuild identifies as a transparent GoA bot', NULL, 'backend', 'deprecated', 'high', 3, 'Tracked as V-005 in vulnerabilities'),
('spec_client_secrets_dropped', 'feature', 'dropped', 'Spec stored API keys in sessionStorage — rebuild never sends keys to the browser', NULL, 'shared', 'deprecated', 'critical', 1, 'Tracked as V-004 in vulnerabilities'),
('spec_open_cors_dropped', 'feature', 'dropped', 'Spec used Access-Control-Allow-Origin: * everywhere — rebuild restricts CORS to FRONTEND_URL', NULL, 'backend', 'deprecated', 'high', 1, 'Tracked as V-003 in vulnerabilities')

ON CONFLICT (name) DO NOTHING;
