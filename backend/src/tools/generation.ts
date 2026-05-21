/**
 * Generation Tools
 *
 * `image_generation` produces an image from a text prompt; routes through GoA
 * Enterprise Tools when configured, falls back to Google AI Studio Gemini
 * image when not. `elevenlabs_tts` calls ElevenLabs' TTS API directly.
 *
 * Both tools persist their output as an artifact (`storeArtifact` on the
 * dispatcher) so the orchestrator can surface them via SSE and the artifacts
 * API endpoint.
 */

import { env } from "../config/env.js";
import { logger } from "../services/logger.js";
import { entImageGeneration, isEntToolsConfigured } from "../services/entToolsClient.js";
import { storeArtifact, type ToolContext } from "../services/toolDispatcher.js";

const USER_AGENT = "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PROMPT_LENGTH = 2000;
const MAX_TTS_TEXT_LENGTH = 5000;

export interface ImageGenerationResult {
  success: boolean;
  artifactId?: string | null;
  persisted?: boolean;
  mimeType?: string;
  sizeBytes?: number;
  provider?: string;
  error?: string;
}

export interface TtsResult {
  success: boolean;
  artifactId?: string | null;
  persisted?: boolean;
  mimeType?: string;
  sizeBytes?: number;
  voiceId?: string;
  error?: string;
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

export async function imageGeneration(
  params: Record<string, unknown>,
  context?: ToolContext
): Promise<ImageGenerationResult> {
  const prompt = (params.prompt as string)?.trim();
  const size = (params.size as string) || "1024x1024";
  const model = params.model as string | undefined;

  if (!prompt) {
    return { success: false, error: "Parameter 'prompt' is required." };
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { success: false, error: `Prompt exceeds ${MAX_PROMPT_LENGTH} character limit.` };
  }
  if (!context) {
    return { success: false, error: "image_generation requires a ToolContext (session info)." };
  }

  let base64: string;
  let mimeType: string;
  let provider: string;

  try {
    if (isEntToolsConfigured()) {
      const out = await entImageGeneration(prompt, { size, model });
      base64 = out.base64;
      mimeType = out.mimeType;
      provider = "ent_tools";
    } else if (env.GOOGLE_AI_API_KEY) {
      const out = await callGeminiImage(prompt);
      base64 = out.base64;
      mimeType = out.mimeType;
      provider = "google_ai";
    } else {
      return {
        success: false,
        error: "image_generation is not configured. Set ENT_TOOLS_API_KEY or GOOGLE_AI_API_KEY.",
      };
    }
  } catch (err) {
    logger.error("image_generation provider call failed", err, { provider: isEntToolsConfigured() ? "ent_tools" : "google_ai" });
    return { success: false, error: `image_generation failed: ${(err as Error).message}` };
  }

  try {
    const titleSuffix = prompt.length > 60 ? `${prompt.substring(0, 57)}...` : prompt;
    const { id, sizeBytes, persisted } = await storeArtifact(context, {
      title: `Generated image: ${titleSuffix}`,
      type: "image",
      content: base64,
      mimeType,
      description: `Prompt: ${prompt}`,
    });
    return { success: true, artifactId: id, persisted, mimeType, sizeBytes, provider };
  } catch (err) {
    return { success: false, error: `Artifact persistence failed: ${(err as Error).message}` };
  }
}

async function callGeminiImage(prompt: string): Promise<{ base64: string; mimeType: string }> {
  const model = "gemini-2.5-flash-image-preview";
  // Pass API key via x-goog-api-key header (not querystring) so it never lands
  // in URL-shaped log lines, network traces, or error envelopes.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "x-goog-api-key": env.GOOGLE_AI_API_KEY ?? "",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini image returned ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const candidates = (data.candidates as Array<Record<string, unknown>>) || [];
    for (const cand of candidates) {
      const content = cand.content as Record<string, unknown> | undefined;
      const parts = (content?.parts as Array<Record<string, unknown>>) || [];
      for (const part of parts) {
        const inlineData = part.inlineData as { mimeType?: string; data?: string } | undefined;
        if (inlineData?.data) {
          return {
            base64: inlineData.data,
            mimeType: inlineData.mimeType || "image/png",
          };
        }
      }
    }
    throw new Error("Gemini image response contained no inlineData payload.");
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// ELEVENLABS TTS
// ============================================================================

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — public default voice

export async function elevenlabsTts(
  params: Record<string, unknown>,
  context?: ToolContext
): Promise<TtsResult> {
  const text = (params.text as string)?.trim();
  const voiceId = (params.voiceId as string) || DEFAULT_VOICE_ID;
  const model = (params.model as string) || "eleven_multilingual_v2";

  if (!text) {
    return { success: false, error: "Parameter 'text' is required." };
  }
  if (!env.ELEVENLABS_API_KEY) {
    return { success: false, error: "ELEVENLABS_API_KEY is not configured." };
  }
  if (!context) {
    return { success: false, error: "elevenlabs_tts requires a ToolContext (session info)." };
  }
  if (text.length > MAX_TTS_TEXT_LENGTH) {
    return { success: false, error: `Text exceeds ${MAX_TTS_TEXT_LENGTH} character cap for elevenlabs_tts.` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let base64: string;
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ text, model_id: model }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error("ElevenLabs TTS failed", null, { status: response.status, error: errText.substring(0, 200) });
      return { success: false, error: `ElevenLabs TTS returned ${response.status}.` };
    }

    const audio = await response.arrayBuffer();
    base64 = Buffer.from(audio).toString("base64");
  } catch (err) {
    return { success: false, error: `ElevenLabs TTS failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timeout);
  }

  try {
    const snippet = text.length > 60 ? `${text.substring(0, 57)}...` : text;
    const { id, sizeBytes, persisted } = await storeArtifact(context, {
      title: `TTS: ${snippet}`,
      type: "audio",
      content: base64,
      mimeType: "audio/mpeg",
      description: `Voice ${voiceId}: ${text}`.substring(0, 1000),
    });
    return { success: true, artifactId: id, persisted, mimeType: "audio/mpeg", sizeBytes, voiceId };
  } catch (err) {
    return { success: false, error: `Artifact persistence failed: ${(err as Error).message}` };
  }
}
