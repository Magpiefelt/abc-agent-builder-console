/**
 * Function Registry (Stream C)
 *
 * Deterministic functions invokable by Function nodes in the workflow canvas.
 * Each handler receives the upstream value as `input` and the node's configured
 * parameters as `params`. Branch-category functions return { matched: boolean }
 * which the executor uses to prune downstream subtrees.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

type FunctionHandler = (input: unknown, params: Record<string, unknown>) => Promise<unknown>;

interface CatalogParam {
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
}

interface CatalogEntry {
  name: string;
  category: "text-transform" | "math" | "parse" | "format" | "branch";
  description: string;
  params: CatalogParam[];
  outputType: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(__dirname, "../data/functionCatalog.json");
const catalog: { functions: CatalogEntry[] } = JSON.parse(readFileSync(catalogPath, "utf-8"));

const handlers: Map<string, FunctionHandler> = new Map();

function register(name: string, fn: FunctionHandler): void {
  handlers.set(name, fn);
}

export function getCatalog(): CatalogEntry[] {
  return catalog.functions;
}

export function isBranchFunction(name: string): boolean {
  return catalog.functions.find((f) => f.name === name)?.category === "branch";
}

export async function runFunction(
  name: string,
  input: unknown,
  params: Record<string, unknown>
): Promise<unknown> {
  const fn = handlers.get(name);
  if (!fn) {
    throw new Error(`Unknown function: ${name}`);
  }
  return fn(input, params);
}

// ============================================================================
// HELPERS
// ============================================================================

function asString(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Expected number, got ${typeof v}`);
}

function getString(params: Record<string, unknown>, key: string, fallback?: string): string {
  const v = params[key];
  if (typeof v === "string") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required string parameter: ${key}`);
}

function getNumber(params: Record<string, unknown>, key: string, fallback?: number): number {
  const v = params[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required number parameter: ${key}`);
}

function getBool(params: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = params[key];
  if (typeof v === "boolean") return v;
  return fallback;
}

// ============================================================================
// TEXT-TRANSFORM
// ============================================================================

register("to_upper", async (input) => asString(input).toUpperCase());
register("to_lower", async (input) => asString(input).toLowerCase());
register("trim", async (input) => asString(input).trim());

register("slugify", async (input) =>
  asString(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
);

register("truncate", async (input, params) => {
  const max = getNumber(params, "maxLength", 200);
  const ellipsis = getString(params, "ellipsis", "…");
  const s = asString(input);
  return s.length > max ? s.slice(0, max) + ellipsis : s;
});

register("replace", async (input, params) => {
  const find = getString(params, "find");
  const replacement = getString(params, "replacement", "");
  const useRegex = getBool(params, "regex", false);
  if (useRegex) {
    return asString(input).replace(new RegExp(find, "g"), replacement);
  }
  return asString(input).split(find).join(replacement);
});

register("template_render", async (input, params) => {
  const template = getString(params, "template");
  const ctx = (input && typeof input === "object" ? (input as Record<string, unknown>) : { value: input });
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split(".");
    let cur: unknown = ctx;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return asString(cur);
  });
});

register("markdown_to_text", async (input) =>
  asString(input)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
);

register("extract_text_between", async (input, params) => {
  const start = getString(params, "start");
  const end = getString(params, "end");
  const s = asString(input);
  const i = s.indexOf(start);
  if (i < 0) return "";
  const j = s.indexOf(end, i + start.length);
  if (j < 0) return "";
  return s.slice(i + start.length, j);
});

register("concat", async (input, params) => {
  const prefix = getString(params, "prefix", "");
  const suffix = getString(params, "suffix", "");
  const sep = getString(params, "separator", "");
  const middle = asString(input);
  return [prefix, middle, suffix].filter(Boolean).join(sep);
});

// ============================================================================
// MATH
// ============================================================================

register("add", async (input, params) => asNumber(input) + getNumber(params, "value"));
register("subtract", async (input, params) => asNumber(input) - getNumber(params, "value"));
register("multiply", async (input, params) => asNumber(input) * getNumber(params, "value"));

register("divide", async (input, params) => {
  const divisor = getNumber(params, "value");
  if (divisor === 0) throw new Error("Division by zero");
  return asNumber(input) / divisor;
});

register("round", async (input, params) => {
  const decimals = getNumber(params, "decimals", 0);
  const factor = Math.pow(10, decimals);
  return Math.round(asNumber(input) * factor) / factor;
});

register("clamp", async (input, params) => {
  const min = getNumber(params, "min");
  const max = getNumber(params, "max");
  return Math.min(Math.max(asNumber(input), min), max);
});

register("percent", async (input, params) => {
  const decimals = getNumber(params, "decimals", 1);
  return (asNumber(input) * 100).toFixed(decimals) + "%";
});

register("sum_array", async (input) => {
  if (!Array.isArray(input)) throw new Error("sum_array expects an array input");
  return input.reduce<number>((acc, v) => acc + asNumber(v), 0);
});

// ============================================================================
// PARSE
// ============================================================================

register("json_parse", async (input) => JSON.parse(asString(input)));

register("json_stringify", async (input, params) => {
  const pretty = getBool(params, "pretty", false);
  return JSON.stringify(input, null, pretty ? 2 : 0);
});

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (c === "\r") {
        // ignore
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

register("csv_parse", async (input, params) =>
  parseCsv(asString(input), getString(params, "delimiter", ","))
);

register("csv_to_json", async (input, params) => {
  const rows = parseCsv(asString(input), getString(params, "delimiter", ","));
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body.map((row) =>
    Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""]))
  );
});

register("yaml_parse", async (input) => {
  // Tiny subset: scalars, key: value pairs, indented blocks.
  // For deeper YAML, users should rely on JSON.
  const text = asString(input);
  const lines = text.split("\n");
  const result: Record<string, unknown> = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (rest === "") {
      result[key] = "";
    } else if (/^-?\d+(\.\d+)?$/.test(rest)) {
      result[key] = Number(rest);
    } else if (rest === "true" || rest === "false") {
      result[key] = rest === "true";
    } else if (rest === "null") {
      result[key] = null;
    } else {
      result[key] = rest.replace(/^['"]|['"]$/g, "");
    }
  }
  return result;
});

register("url_parse", async (input) => {
  const url = new URL(asString(input));
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  return {
    protocol: url.protocol,
    host: url.host,
    pathname: url.pathname,
    query,
    hash: url.hash,
  };
});

register("regex_match", async (input, params) => {
  const re = new RegExp(getString(params, "pattern"), getString(params, "flags", ""));
  const m = asString(input).match(re);
  return m ? [...m] : null;
});

register("regex_extract_all", async (input, params) => {
  const flags = getString(params, "flags", "g");
  const finalFlags = flags.includes("g") ? flags : flags + "g";
  const re = new RegExp(getString(params, "pattern"), finalFlags);
  const out: string[] = [];
  const s = asString(input);
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
});

register("date_parse_iso", async (input) => {
  const t = Date.parse(asString(input));
  if (Number.isNaN(t)) throw new Error(`Cannot parse date: ${asString(input)}`);
  return t;
});

// ============================================================================
// FORMAT
// ============================================================================

function getDateFromInput(input: unknown): Date {
  if (typeof input === "number") return new Date(input);
  if (typeof input === "string") {
    const t = Date.parse(input);
    if (!Number.isNaN(t)) return new Date(t);
  }
  if (input instanceof Date) return input;
  throw new Error("date_format expects a number (epoch ms) or ISO string");
}

register("date_format", async (input, params) => {
  const pattern = getString(params, "pattern", "yyyy-MM-dd");
  const tz = getString(params, "timezone", "America/Edmonton");
  const d = getDateFromInput(input);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(d).map((p) => [p.type, p.value])
  );
  return pattern
    .replace(/yyyy/g, parts.year ?? "")
    .replace(/MM/g, parts.month ?? "")
    .replace(/dd/g, parts.day ?? "")
    .replace(/HH/g, parts.hour ?? "")
    .replace(/mm/g, parts.minute ?? "")
    .replace(/ss/g, parts.second ?? "");
});

register("number_format", async (input, params) => {
  const decimals = getNumber(params, "decimals", 2);
  const locale = getString(params, "locale", "en-CA");
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(asNumber(input));
});

register("currency_cad", async (input, params) => {
  const decimals = getNumber(params, "decimals", 2);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(asNumber(input));
});

register("json_pretty", async (input) => {
  const value = typeof input === "string" ? safeParse(input) : input;
  return JSON.stringify(value, null, 2);
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

register("markdown_table", async (input, params) => {
  if (!Array.isArray(input) || input.length === 0) return "";
  const first = input[0];
  if (!first || typeof first !== "object") return "";
  const columns = Array.isArray(params.columns) && params.columns.length > 0
    ? (params.columns as string[])
    : Object.keys(first as Record<string, unknown>);
  const header = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = input.map((row) => {
    const r = row as Record<string, unknown>;
    return `| ${columns.map((c) => asString(r[c]).replace(/\|/g, "\\|")).join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
});

register("wrap_code_fence", async (input, params) => {
  const lang = getString(params, "language", "");
  return "```" + lang + "\n" + asString(input) + "\n```";
});

register("title_case", async (input) =>
  asString(input).replace(/\w\S*/g, (word) => {
    if (word === word.toUpperCase() && word.length > 1) return word; // preserve acronyms
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  })
);

register("kebab_case", async (input) =>
  asString(input)
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
);

register("snake_case", async (input) =>
  asString(input)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "")
);

// ============================================================================
// BRANCH
// ============================================================================

register("equals", async (input, params) => ({
  matched: asString(input) === getString(params, "value"),
}));

register("not_equals", async (input, params) => ({
  matched: asString(input) !== getString(params, "value"),
}));

register("contains", async (input, params) => {
  const sub = getString(params, "substring");
  const ci = getBool(params, "caseInsensitive", false);
  const hay = ci ? asString(input).toLowerCase() : asString(input);
  const needle = ci ? sub.toLowerCase() : sub;
  return { matched: hay.includes(needle) };
});

register("starts_with", async (input, params) => {
  const prefix = getString(params, "prefix");
  const ci = getBool(params, "caseInsensitive", false);
  const hay = ci ? asString(input).toLowerCase() : asString(input);
  const needle = ci ? prefix.toLowerCase() : prefix;
  return { matched: hay.startsWith(needle) };
});

register("regex_test", async (input, params) => {
  const re = new RegExp(getString(params, "pattern"), getString(params, "flags", ""));
  return { matched: re.test(asString(input)) };
});

register("gt", async (input, params) => ({
  matched: asNumber(input) > getNumber(params, "value"),
}));

register("lt", async (input, params) => ({
  matched: asNumber(input) < getNumber(params, "value"),
}));

register("between", async (input, params) => {
  const v = asNumber(input);
  return { matched: v >= getNumber(params, "min") && v <= getNumber(params, "max") };
});

// ============================================================================
// VERIFY REGISTRY COVERAGE AT MODULE LOAD
// ============================================================================

(function verify() {
  const missing: string[] = [];
  for (const f of catalog.functions) {
    if (!handlers.has(f.name)) missing.push(f.name);
  }
  if (missing.length > 0) {
    logger.error("Function registry missing implementations", undefined, { missing });
    throw new Error(`Function registry missing implementations: ${missing.join(", ")}`);
  }
  logger.info("Function registry loaded", { count: handlers.size });
})();
