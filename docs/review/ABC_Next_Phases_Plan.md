# ABC Agent Builder Console — Next Phases Work Plan

**Date:** May 21, 2026
**Author:** Manus AI
**Target Repository:** `Magpiefelt/abc-agent-builder-console`

## 1. Context and Current State

The ABC Agent Builder Console rebuild has successfully completed the majority of its planned work streams. Streams A (Identity), B (Free Agent UX), and C (Workflow Canvas) are fully implemented and wired end-to-end. The application correctly enforces the "Thin Client / Thick Server" architecture, handles PII scanning, and manages user-scoped memory and workflows.

However, to meet the final exit criteria of the AI Garage exercise, several critical gaps remain. These gaps primarily involve finalizing the Enterprise Tools integration (Stream D), operationalizing the evaluation harness (Stream E), completing the compliance artifacts, and executing the Nexus deployment (Stream F). Furthermore, the project documentation has drifted significantly from the codebase reality and requires immediate remediation.

This document outlines the prioritized next phases of work to bring the project to full completion.

## 2. Prioritized Work Plan

The remaining work is divided into three sequential phases, prioritized by their impact on the final Authority to Operate (ATO) and exercise exit criteria.

### Phase 1: Codebase Polish and Documentation Remediation

Before advancing to deployment and evaluations, the codebase and its accompanying documentation must be synchronized and polished.

**Tasks:**
1.  **Update `00_MASTER_PLAN.md`:** Revise the master plan to accurately reflect the completion of Streams A, B, and C. The current document incorrectly lists these as "Not started" or "Pending".
2.  **Update `accessibility_audit.md`:** The accessibility audit document must be updated to acknowledge the existence of the Free Agent and Workflow views, which are currently marked as out of scope or placeholders. A new accessibility pass should be conducted on these views.
3.  **Resolve ESLint Warnings:** Address the 9 minor ESLint warnings in the backend (e.g., unused variables in `workflowExecutor.ts` and `utilities.ts`, and `prefer-const` suggestions) to ensure a perfectly clean build.
4.  **Fix Frontend Bugs:**
    *   Resolve the missing `ExecutionPanel` import in `frontend/src/views/WorkflowView.vue`. The component is used in the template but not imported in the script setup.
    *   Fix the `[Vue Router warn]: No match found for location with path "/admin"` warnings occurring during frontend unit tests by adding the appropriate mock route to the test setup.
    *   Implement the `ministryFilter` logic in `WorkflowListView.vue`. The UI dropdown exists, but the `filtered` computed property currently only filters by search text.
5.  **Update `agentSession.test.ts`:** Convert the 13 `it.todo` contract test scaffolds in `frontend/src/stores/__tests__/agentSession.test.ts` into actual tests, as the `agentSession` store is now fully implemented.

### Phase 2: Stream D (Enterprise Tools) and Stream E (Evaluations) Completion

This phase focuses on finalizing the external integrations and generating the required quality and security evidence.

**Tasks:**
1.  **Verify Enterprise Tools Integration (Stream D):** Ensure that the `entToolsClient.ts` correctly routes Brave Search and Image Generation requests through the GoA Enterprise Tools proxy (`ent-tools.sandbox.aim.int.gov.ab.ca`) when the `ENT_TOOLS_API_KEY` is present.
2.  **Execute Evaluation Scenarios (Stream E):** Run the existing evaluation scenarios (`01_research_task.json`, `02_loop_detection.json`, `03_pii_blocking.json`, `04_classification_routing.json`) using the `scenarioRunner.ts` harness. Ensure all scenarios pass against the current backend implementation.
3.  **Finalize Red/Blue Security Report:** Update `docs/security/red_blue_report.md` to close out the remaining operational follow-ups. Specifically, verify that the real Entra ID JWT validation in `auth.ts` is active and that the `NODE_ENV=development` rate-limit bypass is disabled for production.

### Phase 3: Stream F (Compliance and Nexus Deployment)

The final phase involves assembling the ATO package and deploying the application to the GoA Nexus environment.

**Tasks:**
1.  **Complete Compliance Artifacts:** Finalize the Privacy Impact Assessment (`docs/privacy/pia.md`) and the Controls Matrix (`docs/security/controls_matrix.md`). Ensure the Threat Model (`threat_model_stride.md`) accurately reflects the current architecture.
2.  **Entra ID App Registration:** Register the production and staging redirect URIs (`https://abc-agent-builder.gov.ab.ca/api/auth/callback` and `https://abc-agent-builder.staging.gov.ab.ca/api/auth/callback`) in the Entra ID application. Obtain the `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID`, and `ENTRA_CLIENT_SECRET`.
3.  **Configure Nexus Secrets:** Populate the Nexus secret store with all required environment variables, including the Entra ID credentials, `DATABASE_URL`, `SECRETS_VAULT_KEY`, `SESSION_SECRET`, and the necessary LLM API keys.
4.  **Execute Deployment:** Run the `.github/workflows/deploy.yml` CI/CD pipeline to build the artifacts and publish them to Nexus using the `nexus/manifest.yaml`.
5.  **Post-Deploy Smoke Test:** Verify the deployment by accessing the production URL, confirming SSO login functionality, and ensuring the `/api/health` endpoint returns a 200 status.

## 3. Exit Criteria Checklist

Completion of the above phases will satisfy the final exit criteria for the AI Garage exercise:

*   [ ] All 6 streams meet their acceptance criteria.
*   [ ] `features`, `vulnerabilities`, `migration`, `plan`, and `privacy_controls` tables are fully populated.
*   [ ] App is deployed at Nexus with SSO functional.
*   [ ] SOAR / STRA package is ready for ATO sign-off.
*   [ ] Red and Blue agent reports are finalized with remediations applied.
*   [ ] Free Agent and Workflow modes faithfully port the spec app's behavior with enhanced security and observability.
