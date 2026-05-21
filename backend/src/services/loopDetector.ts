/**
 * Loop Detection Service
 * 
 * Detects when the agent is stuck in repetitive patterns and provides
 * escalating intervention guidance. Uses a 5-level detection algorithm:
 * 
 * Level 1: Exact repetition — same response content hash repeated
 * Level 2: Tool call patterns — same tool called with same params repeatedly
 * Level 3: N-gram analysis — repeated sequences of tool call patterns
 * Level 4: Semantic similarity — similar thinking/reasoning patterns (Jaccard)
 * Level 5: Progress stall — no new blackboard entries over N iterations
 * 
 * Features:
 * - Configurable thresholds per detection level
 * - Escalating interventions (gentle → firm → forced stop)
 * - Reset on user interjection (gives agent a fresh chance)
 * - Exportable metrics for monitoring
 * - Structured logging integration
 */

import { logger } from "./logger.js";

// ============================================================================
// TYPES
// ============================================================================

export interface IterationRecord {
  iteration: number;
  thinking: string;
  toolCalls: Array<{ tool: string; params: Record<string, unknown> }>;
  blackboardUpdates: number;
  status: string;
  contentHash: string;
  toolSignatures: string[];
}

export interface LoopDetectionResult {
  detected: boolean;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  description: string;
  intervention: string;
  confidence: number; // 0-1
  shouldForceStop: boolean;
}

export interface LoopDetectorConfig {
  /** How many recent iterations to analyze */
  windowSize: number;
  /** Minimum iterations before detection activates */
  minIterations: number;
  /** Threshold for exact content repetition (count) */
  exactRepeatThreshold: number;
  /** Threshold for tool pattern repetition (count) */
  toolPatternThreshold: number;
  /** N-gram size for sequence detection */
  ngramSize: number;
  /** Threshold for n-gram repetition */
  ngramRepeatThreshold: number;
  /** Iterations without blackboard progress before stall detection */
  progressStallThreshold: number;
  /** Jaccard similarity threshold for semantic detection (0-1) */
  similarityThreshold: number;
  /** Number of interventions before forcing a stop */
  maxInterventionsBeforeStop: number;
}

export interface LoopDetectorMetrics {
  totalIterationsAnalyzed: number;
  detectionsTriggered: number;
  interventionsSent: number;
  forcedStops: number;
  levelCounts: Record<number, number>;
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
  windowSize: 12,
  minIterations: 3,
  exactRepeatThreshold: 2,
  toolPatternThreshold: 3,
  ngramSize: 3,
  ngramRepeatThreshold: 2,
  progressStallThreshold: 5,
  similarityThreshold: 0.75,
  maxInterventionsBeforeStop: 4,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a fast hash of a string for equality comparison.
 */
export function hashContent(content: string): string {
  let hash = 0;
  const str = content.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Create a normalized signature for a tool call.
 */
function toolCallSignature(tool: string, params: Record<string, unknown>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join("&");
  return `${tool}(${sortedParams})`;
}

/**
 * Calculate Jaccard similarity between two sets of word tokens.
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 2));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract n-grams from a sequence of tool signatures.
 */
function extractNgrams(signatures: string[], n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= signatures.length - n; i++) {
    ngrams.push(signatures.slice(i, i + n).join(" → "));
  }
  return ngrams;
}

// ============================================================================
// LOOP DETECTOR CLASS
// ============================================================================

export class LoopDetector {
  private history: IterationRecord[] = [];
  private config: LoopDetectorConfig;
  private interventionCount = 0;
  private metrics: LoopDetectorMetrics = {
    totalIterationsAnalyzed: 0,
    detectionsTriggered: 0,
    interventionsSent: 0,
    forcedStops: 0,
    levelCounts: {},
  };

  constructor(config?: Partial<LoopDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a completed iteration for analysis.
   */
  recordIteration(record: Omit<IterationRecord, "contentHash" | "toolSignatures">): void {
    const contentHash = hashContent(
      record.thinking + JSON.stringify(record.toolCalls)
    );
    const toolSignatures = record.toolCalls.map((tc) =>
      toolCallSignature(tc.tool, tc.params)
    );

    this.history.push({ ...record, contentHash, toolSignatures });
    this.metrics.totalIterationsAnalyzed++;

    // Keep bounded history
    if (this.history.length > this.config.windowSize * 2) {
      this.history = this.history.slice(-this.config.windowSize * 2);
    }
  }

  /**
   * Run all detection levels and return the highest-severity result.
   */
  detect(): LoopDetectionResult {
    if (this.history.length < this.config.minIterations) {
      return noDetection();
    }

    const window = this.history.slice(-this.config.windowSize);

    // Check levels in order of severity (most definitive first)
    const results: LoopDetectionResult[] = [
      this.detectExactRepetition(window),
      this.detectToolPatterns(window),
      this.detectNgramPatterns(window),
      this.detectSemanticSimilarity(window),
      this.detectProgressStall(window),
    ];

    // Find the highest-confidence detection
    const detected = results
      .filter((r) => r.detected)
      .sort((a, b) => b.confidence - a.confidence);

    if (detected.length > 0) {
      const best = detected[0];
      this.metrics.detectionsTriggered++;
      this.metrics.levelCounts[best.level] = (this.metrics.levelCounts[best.level] || 0) + 1;

      // Check if we should force stop
      if (this.interventionCount >= this.config.maxInterventionsBeforeStop) {
        best.shouldForceStop = true;
        this.metrics.forcedStops++;
        logger.warn("Loop detector forcing stop after max interventions", {
          interventionCount: this.interventionCount,
          level: best.level,
          confidence: best.confidence,
        });
      }

      return best;
    }

    return noDetection();
  }

  /**
   * Level 1: Detect exact content repetition.
   */
  private detectExactRepetition(window: IterationRecord[]): LoopDetectionResult {
    const hashCounts: Record<string, number> = {};
    for (const record of window) {
      hashCounts[record.contentHash] = (hashCounts[record.contentHash] || 0) + 1;
    }

    const maxRepeat = Math.max(...Object.values(hashCounts), 0);
    const detected = maxRepeat >= this.config.exactRepeatThreshold;
    const confidence = Math.min(maxRepeat / (this.config.exactRepeatThreshold + 1), 1);

    return {
      detected,
      level: 1,
      description: `Exact response repeated ${maxRepeat} times in the last ${window.length} iterations.`,
      intervention: detected ? this.getIntervention(1) : "",
      confidence,
      shouldForceStop: false,
    };
  }

  /**
   * Level 2: Detect repetitive tool call patterns.
   */
  private detectToolPatterns(window: IterationRecord[]): LoopDetectionResult {
    const allSignatures: string[] = [];
    for (const record of window) {
      allSignatures.push(...record.toolSignatures);
    }

    const sigCounts: Record<string, number> = {};
    for (const sig of allSignatures) {
      sigCounts[sig] = (sigCounts[sig] || 0) + 1;
    }

    const maxRepeat = Math.max(...Object.values(sigCounts), 0);
    const detected = maxRepeat >= this.config.toolPatternThreshold;
    const confidence = Math.min(maxRepeat / (this.config.toolPatternThreshold + 2), 1);

    const repeatedSig = Object.entries(sigCounts).find(([, count]) => count === maxRepeat);
    const toolName = repeatedSig ? repeatedSig[0].split("(")[0] : "unknown";

    return {
      detected,
      level: 2,
      description: `Tool "${toolName}" called with same parameters ${maxRepeat} times.`,
      intervention: detected ? this.getIntervention(2) : "",
      confidence,
      shouldForceStop: false,
    };
  }

  /**
   * Level 3: Detect repeated n-gram sequences of tool calls.
   * Catches patterns like: search → scrape → search → scrape → search → scrape
   */
  private detectNgramPatterns(window: IterationRecord[]): LoopDetectionResult {
    // Build a flat sequence of tool names (not full signatures, just names)
    const toolSequence: string[] = [];
    for (const record of window) {
      for (const tc of record.toolCalls) {
        toolSequence.push(tc.tool);
      }
    }

    if (toolSequence.length < this.config.ngramSize * 2) {
      return noDetection(3);
    }

    const ngrams = extractNgrams(toolSequence, this.config.ngramSize);
    const ngramCounts: Record<string, number> = {};
    for (const ng of ngrams) {
      ngramCounts[ng] = (ngramCounts[ng] || 0) + 1;
    }

    const maxRepeat = Math.max(...Object.values(ngramCounts), 0);
    const detected = maxRepeat >= this.config.ngramRepeatThreshold;
    const confidence = Math.min(maxRepeat / (this.config.ngramRepeatThreshold + 1), 1);

    const repeatedNgram = Object.entries(ngramCounts).find(([, count]) => count === maxRepeat);

    return {
      detected,
      level: 3,
      description: `Tool sequence pattern "${repeatedNgram?.[0] || "?"}" repeated ${maxRepeat} times.`,
      intervention: detected ? this.getIntervention(3) : "",
      confidence,
      shouldForceStop: false,
    };
  }

  /**
   * Level 4: Detect semantically similar thinking patterns.
   */
  private detectSemanticSimilarity(window: IterationRecord[]): LoopDetectionResult {
    if (window.length < 3) {
      return noDetection(4);
    }

    let highSimilarityCount = 0;
    let maxSimilarity = 0;

    for (let i = 1; i < window.length; i++) {
      const similarity = jaccardSimilarity(window[i - 1].thinking, window[i].thinking);
      if (similarity > this.config.similarityThreshold) {
        highSimilarityCount++;
      }
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    const detected = highSimilarityCount >= 2;
    const confidence = Math.min(highSimilarityCount / 3, 1) * maxSimilarity;

    return {
      detected,
      level: 4,
      description: `Agent reasoning is ${(maxSimilarity * 100).toFixed(0)}% similar across ${highSimilarityCount + 1} consecutive iterations.`,
      intervention: detected ? this.getIntervention(4) : "",
      confidence,
      shouldForceStop: false,
    };
  }

  /**
   * Level 5: Detect progress stall (no new blackboard entries).
   */
  private detectProgressStall(window: IterationRecord[]): LoopDetectionResult {
    if (window.length < this.config.progressStallThreshold) {
      return noDetection(5);
    }

    const recentWindow = window.slice(-this.config.progressStallThreshold);
    const totalUpdates = recentWindow.reduce((sum, r) => sum + r.blackboardUpdates, 0);
    const detected = totalUpdates === 0;
    const confidence = detected ? 0.85 : 0;

    return {
      detected,
      level: 5,
      description: `No new blackboard entries in the last ${this.config.progressStallThreshold} iterations.`,
      intervention: detected ? this.getIntervention(5) : "",
      confidence,
      shouldForceStop: false,
    };
  }

  /**
   * Generate an escalating intervention message.
   */
  private getIntervention(level: number): string {
    this.interventionCount++;
    this.metrics.interventionsSent++;

    // Escalation stages based on intervention count
    const stage = Math.min(this.interventionCount, 4);

    const interventions: Record<number, Record<number, string>> = {
      // Stage 1: Gentle nudge
      1: {
        1: "You appear to be repeating yourself. Try a different approach to make progress.",
        2: "You're calling the same tool repeatedly with identical parameters. Try different parameters or a different tool.",
        3: "You're following the same sequence of tool calls. Break the pattern — try something new.",
        4: "Your reasoning is very similar to previous iterations. Step back and reconsider your strategy.",
        5: "You haven't recorded any new findings recently. Write what you've learned to the blackboard.",
      },
      // Stage 2: Firm guidance
      2: {
        1: "STOP repeating the same response. You MUST try a fundamentally different approach NOW.",
        2: "STOP calling the same tool with the same parameters. The result will NOT change. Use a DIFFERENT tool or DIFFERENT parameters.",
        3: "You are stuck in a tool call loop. BREAK the pattern: (1) Review your blackboard, (2) Identify what's blocking you, (3) Try a completely new strategy.",
        4: "Your thinking is circular. Write your current understanding to the scratchpad, then approach from a completely new angle.",
        5: "You have made NO progress in several iterations. Either: record findings to blackboard, try a new approach, or set status to 'needs_assistance'.",
      },
      // Stage 3: Strong warning
      3: {
        1: "CRITICAL: You have repeated the same response multiple times. If you cannot make progress, set status to 'needs_assistance' and explain what you need.",
        2: "CRITICAL: Repeated identical tool calls detected. This is your final warning before the system intervenes. Change your approach IMMEDIATELY.",
        3: "CRITICAL: Tool sequence loop detected. You MUST break this pattern or set status to 'needs_assistance'.",
        4: "CRITICAL: Circular reasoning detected. Set status to 'needs_assistance' if you cannot find a new approach.",
        5: "CRITICAL: Extended stall detected. Set status to 'completed' with your current findings, or 'needs_assistance' if blocked.",
      },
      // Stage 4: Final warning before forced stop
      4: {
        1: "FINAL WARNING: The system will terminate this session if you repeat again. Set status to 'completed' or 'needs_assistance' NOW.",
        2: "FINAL WARNING: One more repeated tool call and the session will be forcibly stopped. Conclude your work NOW.",
        3: "FINAL WARNING: Session will be terminated on next loop detection. Provide your final report NOW.",
        4: "FINAL WARNING: Session termination imminent. Set status to 'completed' with whatever you have.",
        5: "FINAL WARNING: Session will end. Set status to 'completed' and summarize your findings.",
      },
    };

    return interventions[stage]?.[level] || interventions[stage]?.[1] || "You appear to be stuck. Try a different approach.";
  }

  /**
   * Reset the detector state. Called after user interjection to give the agent a fresh start.
   */
  reset(): void {
    this.history = [];
    this.interventionCount = 0;
    logger.debug("Loop detector reset (user interjection)");
  }

  /**
   * Partially reset — reduce intervention count but keep history.
   * Used when the agent shows some progress after a warning.
   */
  softReset(): void {
    this.interventionCount = Math.max(0, this.interventionCount - 2);
  }

  /**
   * Get the current history length.
   */
  getHistoryLength(): number {
    return this.history.length;
  }

  /**
   * Get metrics for monitoring.
   */
  getMetrics(): LoopDetectorMetrics {
    return { ...this.metrics };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function noDetection(level: 0 | 1 | 2 | 3 | 4 | 5 = 0): LoopDetectionResult {
  return { detected: false, level, description: "", intervention: "", confidence: 0, shouldForceStop: false };
}
