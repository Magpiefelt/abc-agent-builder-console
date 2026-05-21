/**
 * Test-only routes. Mounted ONLY when MOCK_LLM=1 is set in the environment,
 * which is the contract the evals harness uses to inject canned LLM responses.
 *
 * Refuses to expose anything when MOCK_LLM is unset, so a production deploy
 * accidentally inheriting this router would still be safe.
 */

import { Router, type Router as RouterType, type Request, type Response } from "express";

const router: RouterType = Router();

router.use((_req: Request, res: Response, next) => {
  if (process.env.MOCK_LLM !== "1") {
    res.status(404).json({ error: "Test routes are not available." });
    return;
  }
  next();
});

/**
 * POST /api/test/mock-llm
 * Body: { sessionId: string, responses: MockLLMResponseInput[] }
 *
 * Registers canned LLM responses for the given sessionId. The MockProvider
 * in llmProvider.ts consumes them one per call.
 */
// Path computed at runtime to keep TS rootDir clean.
const MOCK_HELPER_PATH = "../" + "../test/helpers/mockLLM.js";

interface MockHelperModule {
  registerMockResponses: (sessionId: string, responses: unknown[]) => void;
  clearMockResponses: () => void;
}

router.post("/mock-llm", async (req: Request, res: Response) => {
  const { sessionId, responses } = req.body || {};
  if (!sessionId || !Array.isArray(responses)) {
    res.status(400).json({ error: "sessionId and responses[] are required." });
    return;
  }

  const helper = (await import(MOCK_HELPER_PATH)) as MockHelperModule;
  helper.registerMockResponses(sessionId, responses);
  res.json({ registered: responses.length });
});

/**
 * POST /api/test/mock-llm/clear
 * Wipes all registered canned responses.
 */
router.post("/mock-llm/clear", async (_req: Request, res: Response) => {
  const helper = (await import(MOCK_HELPER_PATH)) as MockHelperModule;
  helper.clearMockResponses();
  res.json({ cleared: true });
});

export default router;
