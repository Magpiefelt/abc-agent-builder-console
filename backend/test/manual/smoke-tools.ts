/**
 * Stream D — Manual smoke test for all 20 edge tools.
 *
 * Invokes each registered handler with a minimal payload and reports
 * PASS / FAIL / SKIP. SKIP is used when the tool's required configuration
 * (API key, allowlist entry, SMTP creds) is absent — that's expected in dev
 * and is not a regression.
 *
 * Run: `pnpm --filter backend exec tsx test/manual/smoke-tools.ts`
 *
 * Exit code: 0 when every required tool reports PASS or SKIP. Non-zero on
 * the first unexpected FAIL.
 */

import { randomUUID } from "node:crypto";
import { env } from "../../src/config/env.js";
import { registerAllTools } from "../../src/tools/register.js";
import { getRegisteredToolCount, dispatchTool, type ToolContext } from "../../src/services/toolDispatcher.js";

interface CaseResult {
  tool: string;
  status: "PASS" | "FAIL" | "SKIP";
  durationMs: number;
  detail?: string;
}

function buildContext(): ToolContext {
  return {
    sessionId: randomUUID(),
    userId: randomUUID(),
    ministryCode: "TECH",
    iteration: 1,
    memory: { blackboard: [], scratchpad: "", attributes: {} },
    onArtifactCreated: (a) => console.log(`   ↳ artifact_created ${a.id} (${a.type}, ${a.sizeBytes}B)`),
  };
}

async function runCase(
  tool: string,
  params: Record<string, unknown>,
  opts: { skipWhen?: () => boolean; skipReason?: string; expectFail?: (err: string) => boolean } = {}
): Promise<CaseResult> {
  if (opts.skipWhen?.()) {
    return { tool, status: "SKIP", durationMs: 0, detail: opts.skipReason };
  }
  const start = Date.now();
  try {
    const { result } = await dispatchTool({ tool, params }, buildContext());
    const dur = Date.now() - start;
    if (result.success) {
      return { tool, status: "PASS", durationMs: dur };
    }
    if (opts.expectFail && opts.expectFail(result.error || "")) {
      return { tool, status: "PASS", durationMs: dur, detail: `(expected refusal: ${result.error})` };
    }
    // Common config-absent failures are SKIP, not FAIL.
    const errLower = (result.error || "").toLowerCase();
    if (
      errLower.includes("not configured") ||
      errLower.includes("not in the allowlist") ||
      errLower.includes("not set") ||
      errLower.includes("requires a ministry") ||
      errLower.includes("rate limit")
    ) {
      return { tool, status: "SKIP", durationMs: dur, detail: result.error };
    }
    return { tool, status: "FAIL", durationMs: dur, detail: result.error };
  } catch (err) {
    return { tool, status: "FAIL", durationMs: Date.now() - start, detail: (err as Error).message };
  }
}

async function main() {
  registerAllTools();
  console.log(`Registered ${getRegisteredToolCount()} edge tools.\n`);

  const results: CaseResult[] = [];

  results.push(await runCase("brave_search", { query: "Alberta government", numResults: 3 },
    { skipWhen: () => !env.BRAVE_SEARCH_API_KEY && !env.ENT_TOOLS_API_KEY, skipReason: "no brave/ent key" }));
  results.push(await runCase("google_search", { query: "Alberta government", numResults: 3 },
    { skipWhen: () => !env.GOOGLE_SEARCH_API_KEY || !env.GOOGLE_SEARCH_CX, skipReason: "no google CSE config" }));
  results.push(await runCase("web_scrape", { url: "https://example.com", maxCharacters: 500 }));
  results.push(await runCase("read_github_repo", { owner: "anthropics", repo: "anthropic-cookbook" }));
  results.push(await runCase("read_github_file", { owner: "anthropics", repo: "anthropic-cookbook", path: "README.md" }));
  results.push(await runCase("pdf_extract_text", { url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", maxPages: 1 }));
  results.push(await runCase("pdf_info", { url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" }));
  // OCR — use a tiny PNG that contains the word "Hello"
  results.push(await runCase("ocr_image", { url: "https://tesseract.projectnaptha.com/img/eng_bw.png", language: "eng" }));
  // Small public ZIP for smoke-only (under 50MB cap).
  // Note: octocat/Hello-World contains a single file `Hello-World-master/README` (no extension).
  const TEST_ZIP_URL = "https://github.com/octocat/Hello-World/archive/refs/heads/master.zip";
  results.push(await runCase("read_zip_contents", { url: TEST_ZIP_URL }));
  results.push(await runCase("read_zip_file", { url: TEST_ZIP_URL, filePath: "Hello-World-master/README" }));
  results.push(await runCase("extract_zip_files", { url: TEST_ZIP_URL }));
  results.push(await runCase("get_call_api", { url: "https://httpbin.org/get" }));
  results.push(await runCase("post_call_api", { url: "https://httpbin.org/post", body: { hello: "world" } }));
  results.push(await runCase("execute_sql", { connection: "primary", sql: "SELECT 1 AS one" }));
  // SSRF refusal — IPv4 loopback must be rejected
  results.push(await runCase("get_call_api", { url: "http://127.0.0.1/" }, {
    expectFail: (e) => /private|internal/i.test(e),
  }));
  // SSRF refusal — IPv6 unique-local (fc00::/7) must be rejected
  results.push(await runCase("get_call_api", { url: "http://[fc00::1]/" }, {
    expectFail: (e) => /private|internal/i.test(e),
  }));
  // SSRF refusal — IPv6 link-local (fe80::/10) must be rejected
  results.push(await runCase("get_call_api", { url: "http://[fe80::1]/" }, {
    expectFail: (e) => /private|internal/i.test(e),
  }));
  results.push(await runCase("read_database_schemas", { connection: "primary" }));
  results.push(await runCase("image_generation", { prompt: "a simple blue square on white background", size: "1024x1024" }));
  results.push(await runCase("elevenlabs_tts", { text: "Hello from Stream D smoke test." }));
  results.push(await runCase("get_time", { timezone: "America/Edmonton" }));
  results.push(await runCase("get_weather", { location: "Edmonton" }));
  results.push(await runCase("send_email", { to: "noreply@gov.ab.ca", subject: "smoke", body: "test" }));

  // Email refusal — non-allowlisted domain must be refused
  results.push(await runCase("send_email", { to: "attacker@example.com", subject: "smoke", body: "test" }, {
    expectFail: (e) => /allowlist/i.test(e),
  }));

  console.log("\n=== RESULTS ===");
  let pass = 0, fail = 0, skip = 0;
  for (const r of results) {
    const tag = r.status === "PASS" ? "[PASS]" : r.status === "FAIL" ? "[FAIL]" : "[SKIP]";
    console.log(`${tag} ${r.tool.padEnd(24)} (${r.durationMs}ms)${r.detail ? "  " + r.detail : ""}`);
    if (r.status === "PASS") pass++;
    else if (r.status === "FAIL") fail++;
    else skip++;
  }
  console.log(`\nSummary: ${pass} pass, ${fail} fail, ${skip} skip / ${results.length} total`);
  console.log(`Tools registered: ${getRegisteredToolCount()}/20\n`);

  if (fail > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(2);
});
