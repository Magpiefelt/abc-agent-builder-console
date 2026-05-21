/**
 * GitHub Tools
 *
 * Implements read_github_repo and read_github_file tools for the agent.
 * Uses the GitHub REST API to list repository structure and read file contents.
 *
 * Supports optional GITHUB_TOKEN for private repos (configured in env.ts).
 */

import { logger } from "../services/logger.js";
import { env } from "../config/env.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)";
const MAX_FILE_SIZE = 1024 * 1024; // 1MB max file content

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

// ============================================================================
// TYPES
// ============================================================================

export interface GitHubFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

export interface GitHubRepoResult {
  success: boolean;
  entries?: GitHubFileEntry[];
  owner?: string;
  repo?: string;
  path?: string;
  branch?: string;
  error?: string;
}

export interface GitHubFileResult {
  success: boolean;
  content?: string;
  path?: string;
  size?: number;
  encoding?: string;
  error?: string;
}

// ============================================================================
// READ GITHUB REPO (list file structure)
// ============================================================================

/**
 * List the file structure of a GitHub repository at a given path.
 */
export async function readGithubRepo(params: Record<string, unknown>): Promise<GitHubRepoResult> {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const path = (params.path as string) || "";
  const branch = (params.branch as string) || "main";

  if (!owner || !repo) {
    return { success: false, error: "Both 'owner' and 'repo' parameters are required." };
  }

  try {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: `Repository or path not found: ${owner}/${repo}/${path} (branch: ${branch})` };
      }
      if (response.status === 403) {
        return { success: false, error: "GitHub API rate limit exceeded or access denied. Try again later or configure GITHUB_TOKEN." };
      }
      return { success: false, error: `GitHub API error (${response.status}): ${response.statusText}` };
    }

    const data = await response.json();

    // GitHub returns an array for directories, an object for files
    if (!Array.isArray(data)) {
      // Single file — return as a single entry
      const file = data as Record<string, unknown>;
      return {
        success: true,
        entries: [{
          name: file.name as string,
          path: file.path as string,
          type: "file",
          size: file.size as number,
        }],
        owner,
        repo,
        path,
        branch,
      };
    }

    const entries: GitHubFileEntry[] = (data as Array<Record<string, unknown>>).map((item) => ({
      name: item.name as string,
      path: item.path as string,
      type: (item.type as string) === "dir" ? "dir" : "file",
      size: (item.size as number) || 0,
    }));

    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      success: true,
      entries,
      owner,
      repo,
      path,
      branch,
    };
  } catch (err) {
    logger.error("GitHub repo listing failed", err, { owner, repo, path });
    return { success: false, error: `GitHub API request failed: ${(err as Error).message}` };
  }
}

// ============================================================================
// READ GITHUB FILE (get file contents)
// ============================================================================

/**
 * Read the contents of a specific file from a GitHub repository.
 */
export async function readGithubFile(params: Record<string, unknown>): Promise<GitHubFileResult> {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const path = params.path as string;
  const branch = (params.branch as string) || "main";

  if (!owner || !repo || !path) {
    return { success: false, error: "Parameters 'owner', 'repo', and 'path' are all required." };
  }

  try {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: `File not found: ${owner}/${repo}/${path} (branch: ${branch})` };
      }
      if (response.status === 403) {
        return { success: false, error: "GitHub API rate limit exceeded or access denied." };
      }
      return { success: false, error: `GitHub API error (${response.status}): ${response.statusText}` };
    }

    const data = await response.json() as Record<string, unknown>;

    // Check if it's a directory (not a file)
    if (data.type === "dir") {
      return { success: false, error: `"${path}" is a directory, not a file. Use read_github_repo to list its contents.` };
    }

    const size = data.size as number;
    if (size > MAX_FILE_SIZE) {
      return { success: false, error: `File too large (${size} bytes). Maximum is ${MAX_FILE_SIZE} bytes.` };
    }

    // Decode base64 content
    const encoding = data.encoding as string;
    let content: string;

    if (encoding === "base64") {
      const base64Content = (data.content as string).replace(/\n/g, "");
      content = Buffer.from(base64Content, "base64").toString("utf-8");
    } else {
      content = data.content as string;
    }

    return {
      success: true,
      content,
      path,
      size,
      encoding: "utf-8",
    };
  } catch (err) {
    logger.error("GitHub file read failed", err, { owner, repo, path });
    return { success: false, error: `GitHub API request failed: ${(err as Error).message}` };
  }
}
