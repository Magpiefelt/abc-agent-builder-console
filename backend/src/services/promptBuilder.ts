/**
 * System Prompt Builder
 * 
 * Assembles the dynamic system prompt from template sections and runtime state.
 * The prompt is rebuilt every iteration with current memory, iteration count,
 * available tools, and any loop detection warnings.
 * 
 * Features:
 * - Configurable template sections with enable/disable and content overrides
 * - Token estimation to stay within model context limits
 * - Priority-based section ordering (critical sections always included)
 * - Dynamic state injection (blackboard, scratchpad, attributes)
 * - Tool manifest formatting for LLM tool-use
 * - Truncation strategy for large memory states
 */

import systemPromptTemplate from "../data/systemPromptTemplate.json" assert { type: "json" };
import toolsManifest from "../data/toolsManifest.json" assert { type: "json" };
import { logger } from "./logger.js";

// ============================================================================
// TYPES
// ============================================================================

export interface PromptSection {
  id: string;
  title: string;
  enabled: boolean;
  content: string;
  /** Priority: 1 = critical (always included), 2 = high, 3 = normal, 4 = optional */
  priority?: number;
}

export interface BlackboardEntry {
  category: string;
  title: string;
  content: string;
  iteration: number;
}

export interface PromptContext {
  /** Current iteration number */
  iteration: number;
  /** Maximum allowed iterations */
  maxIterations: number;
  /** Current session status */
  status: string;
  /** Blackboard entries */
  blackboard: BlackboardEntry[];
  /** Current scratchpad content */
  scratchpad: string;
  /** Session attributes */
  attributes: Record<string, unknown>;
  /** User's original prompt/task */
  prompt: string;
  /** Optional loop detection warning to inject */
  loopWarning?: string;
  /** Optional section overrides from user customization */
  sectionOverrides?: Partial<Record<string, { enabled?: boolean; content?: string }>>;
  /** Optional tool filter (only include these tool names) */
  enabledTools?: string[];
  /** Maximum token budget for the system prompt (estimated) */
  maxPromptTokens?: number;
  /** Previous iteration's tool results (for context continuity) */
  previousToolResults?: Array<{ tool: string; success: boolean; summary: string }>;
}

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

/**
 * Rough token estimation: ~4 characters per token for English text.
 * This is a heuristic — actual tokenization varies by model.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to approximately fit within a token budget.
 */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 100) + "\n\n...[TRUNCATED — content exceeds budget]...";
}

// ============================================================================
// TEMPLATE PROCESSING
// ============================================================================

/** Section priority defaults */
const SECTION_PRIORITIES: Record<string, number> = {
  identity: 1,
  response_format: 1,
  security_rules: 1,
  capabilities: 2,
  memory_system: 2,
  iteration_rules: 2,
  quality_standards: 3,
};

/**
 * Get the base sections from the template, applying any user overrides.
 */
function getSections(overrides?: PromptContext["sectionOverrides"]): PromptSection[] {
  const sections = systemPromptTemplate.sections.map((s) => ({
    ...s,
    priority: SECTION_PRIORITIES[s.id] || 3,
  }));

  if (overrides) {
    for (const section of sections) {
      const override = overrides[section.id];
      if (override) {
        if (override.enabled !== undefined) section.enabled = override.enabled;
        if (override.content !== undefined) section.content = override.content;
      }
    }
  }

  // Sort by priority (lower number = higher priority)
  sections.sort((a, b) => (a.priority || 3) - (b.priority || 3));

  return sections;
}

/**
 * Format blackboard entries for inclusion in the prompt.
 * Groups by category and shows most recent entries first within each group.
 */
function formatBlackboard(entries: BlackboardEntry[], maxTokens?: number): string {
  if (entries.length === 0) {
    return "_No entries yet._";
  }

  // Group by category
  const grouped: Record<string, BlackboardEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.category]) grouped[entry.category] = [];
    grouped[entry.category].push(entry);
  }

  const lines: string[] = [];
  const categories = Object.keys(grouped).sort();

  for (const category of categories) {
    const categoryEntries = grouped[category];
    lines.push(`**[${category}]** (${categoryEntries.length} entries)`);
    
    // Show most recent entries first, limit per category if too many
    const sorted = [...categoryEntries].sort((a, b) => b.iteration - a.iteration);
    const shown = sorted.slice(0, 10); // Max 10 per category
    
    for (const entry of shown) {
      // Truncate individual entry content to prevent prompt explosion
      const content = entry.content.length > 500
        ? entry.content.substring(0, 500) + "..."
        : entry.content;
      lines.push(`  - **${entry.title}** (iter ${entry.iteration}): ${content}`);
    }
    
    if (sorted.length > 10) {
      lines.push(`  - _...and ${sorted.length - 10} more entries_`);
    }
    lines.push("");
  }

  const result = lines.join("\n");
  
  // Apply token budget if specified
  if (maxTokens && estimateTokens(result) > maxTokens) {
    return truncateToTokenBudget(result, maxTokens);
  }

  return result;
}

/**
 * Format attributes for inclusion in the prompt.
 */
function formatAttributes(attributes: Record<string, unknown>): string {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return "_No attributes set._";

  return entries
    .map(([key, value]) => {
      const valStr = typeof value === "string" ? value : JSON.stringify(value);
      const truncated = valStr.length > 200 ? valStr.substring(0, 200) + "..." : valStr;
      return `- **${key}**: ${truncated}`;
    })
    .join("\n");
}

/**
 * Format the available tools list for inclusion in the prompt.
 */
function formatToolsList(enabledTools?: string[]): string {
  let tools = toolsManifest.tools;

  if (enabledTools && enabledTools.length > 0) {
    tools = tools.filter((t) => enabledTools.includes(t.name));
  }

  // Group by category
  const grouped: Record<string, typeof tools> = {};
  for (const tool of tools) {
    if (!grouped[tool.category]) grouped[tool.category] = [];
    grouped[tool.category].push(tool);
  }

  const lines: string[] = [];
  for (const [category, categoryTools] of Object.entries(grouped)) {
    lines.push(`### ${category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`);
    for (const tool of categoryTools) {
      const requiredParams = (tool.parameters.required as string[]) || [];
      const properties = tool.parameters.properties as Record<string, { type: string; description?: string }> || {};
      
      const paramList = Object.entries(properties)
        .map(([name, schema]) => {
          const required = requiredParams.includes(name) ? " **(required)**" : "";
          return `\`${name}\` (${schema.type})${required}`;
        })
        .join(", ");
      
      lines.push(`- **${tool.name}**: ${tool.description}`);
      if (paramList) {
        lines.push(`  Params: ${paramList}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format previous tool results for context continuity.
 */
function formatPreviousResults(results: PromptContext["previousToolResults"]): string {
  if (!results || results.length === 0) return "";

  const lines = ["### Previous Iteration Results"];
  for (const r of results) {
    const icon = r.success ? "✓" : "✗";
    lines.push(`- ${icon} **${r.tool}**: ${r.summary}`);
  }
  return lines.join("\n");
}

/**
 * Replace template variables in a string.
 */
function interpolate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Build the complete system prompt for an agent iteration.
 * Combines static template sections with dynamic runtime state.
 * Respects token budget by truncating lower-priority content first.
 */
export function buildSystemPrompt(context: PromptContext): string {
  const maxPromptTokens = context.maxPromptTokens || 12000; // Default ~48K chars
  const parts: string[] = [];
  let currentTokenEstimate = 0;

  // 1. Static sections (sorted by priority)
  const sections = getSections(context.sectionOverrides);
  for (const section of sections) {
    if (!section.enabled) continue;
    const sectionText = `## ${section.title}\n\n${section.content}`;
    const sectionTokens = estimateTokens(sectionText);
    
    // Always include priority 1 sections; skip lower priority if over budget
    if (currentTokenEstimate + sectionTokens > maxPromptTokens && (section.priority || 3) > 1) {
      logger.debug("Skipping section due to token budget", { section: section.id, priority: section.priority });
      continue;
    }
    
    parts.push(sectionText);
    currentTokenEstimate += sectionTokens;
  }

  // 2. Available tools (budget: ~3000 tokens)
  const toolsList = formatToolsList(context.enabledTools);
  const toolsSection = interpolate(
    systemPromptTemplate.dynamic_sections.available_tools,
    { toolsList }
  );
  const toolsTokens = estimateTokens(toolsSection);
  if (currentTokenEstimate + toolsTokens < maxPromptTokens) {
    parts.push(toolsSection);
    currentTokenEstimate += toolsTokens;
  }

  // 3. Current state (iteration, memory) — budget-aware
  const remainingBudget = maxPromptTokens - currentTokenEstimate - 2000; // Reserve 2000 for task + warnings
  const blackboardBudget = Math.max(Math.floor(remainingBudget * 0.5), 500);
  const scratchpadBudget = Math.max(Math.floor(remainingBudget * 0.3), 300);

  const blackboardFormatted = formatBlackboard(context.blackboard, blackboardBudget);
  const attributesFormatted = formatAttributes(context.attributes);
  const scratchpadContent = context.scratchpad
    ? truncateToTokenBudget(context.scratchpad, scratchpadBudget)
    : "_Empty._";

  const budgetPercent = Math.round(((context.maxIterations - context.iteration) / context.maxIterations) * 100);

  const stateSection = interpolate(
    systemPromptTemplate.dynamic_sections.current_state,
    {
      iteration: String(context.iteration),
      maxIterations: String(context.maxIterations),
      status: context.status,
      budgetPercent: String(budgetPercent),
      blackboardCount: String(context.blackboard.length),
      blackboard: blackboardFormatted,
      scratchpad: scratchpadContent,
      attributes: attributesFormatted,
    }
  );
  parts.push(stateSection);

  // 4. Previous tool results (if any)
  if (context.previousToolResults && context.previousToolResults.length > 0) {
    parts.push(formatPreviousResults(context.previousToolResults));
  }

  // 5. Loop detection warning (if any)
  if (context.loopWarning) {
    const loopSection = interpolate(
      systemPromptTemplate.dynamic_sections.loop_warning,
      { loopWarning: context.loopWarning }
    );
    parts.push(loopSection);
  }

  // 6. User task (always last for recency bias)
  const taskSection = interpolate(
    systemPromptTemplate.dynamic_sections.user_task,
    { prompt: context.prompt }
  );
  parts.push(taskSection);

  const fullPrompt = parts.join("\n\n---\n\n");
  const finalTokenEstimate = estimateTokens(fullPrompt);

  logger.debug("System prompt built", {
    iteration: context.iteration,
    estimatedTokens: finalTokenEstimate,
    sections: sections.filter((s) => s.enabled).length,
    blackboardEntries: context.blackboard.length,
    hasLoopWarning: !!context.loopWarning,
  });

  return fullPrompt;
}

/**
 * Get the list of available tool definitions for LLM tool-use.
 * Returns them in the format expected by the LLM provider.
 */
export function getToolDefinitions(enabledTools?: string[]): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  let tools = toolsManifest.tools;

  if (enabledTools && enabledTools.length > 0) {
    tools = tools.filter((t) => enabledTools.includes(t.name));
  }

  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Get available template sections for the prompt customizer UI.
 */
export function getTemplateSections(): PromptSection[] {
  return systemPromptTemplate.sections.map((s) => ({
    ...s,
    priority: SECTION_PRIORITIES[s.id] || 3,
  }));
}

/**
 * Estimate the token count for a given prompt context (without building the full prompt).
 * Useful for pre-flight budget checks.
 */
export function estimatePromptTokens(context: PromptContext): number {
  const prompt = buildSystemPrompt(context);
  return estimateTokens(prompt);
}
