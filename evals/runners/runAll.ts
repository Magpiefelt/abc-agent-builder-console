/**
 * Run every scenario file in evals/scenarios/ against a single backend instance.
 *
 * Exits 0 if all scenarios pass, 1 if any fail, 2 on infrastructure errors.
 */

import { listScenarios, loadScenario, runScenario, spawnBackend, tearDownBackend } from "./scenarioRunner.js";

async function main(): Promise<void> {
  const paths = listScenarios();
  if (paths.length === 0) {
    console.error("No scenarios found under evals/scenarios/");
    process.exit(2);
  }

  console.log(`Spawning backend (MOCK_LLM=1, ephemeral schema)…`);
  const backend = await spawnBackend();

  try {
    let passed = 0;
    let failed = 0;
    for (const path of paths) {
      const scenario = loadScenario(path);
      console.log(`\n→ ${scenario.name}: ${scenario.description}`);
      const result = await runScenario(scenario, backend);
      if (result.passed) {
        console.log(`  ✓ passed (${result.durationMs}ms, ${result.events.length} SSE events)`);
        passed++;
      } else {
        console.log(`  ✗ failed (${result.durationMs}ms)`);
        for (const f of result.failures) console.log(`    - ${f}`);
        failed++;
      }
    }

    console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
    process.exit(failed === 0 ? 0 : 1);
  } finally {
    await tearDownBackend(backend);
  }
}

main().catch((err) => {
  console.error("Evals harness crashed:", err);
  process.exit(2);
});
