export const ACTOR_PROMPT_MARKER = "<!-- pi-fusion:actor-prompt -->";

export interface FusionSettings {
  enabled: boolean;
  workerCount: number;
  workerOutputBytes: number;
  contextBytes: number;
  timeoutMs: number;
  model: string | undefined;
}

export interface FusionFlags {
  "fusion-disabled"?: boolean | string;
  "fusion-workers"?: boolean | string;
  "fusion-output-bytes"?: boolean | string;
  "fusion-context-bytes"?: boolean | string;
  "fusion-timeout-ms"?: boolean | string;
  "fusion-model"?: boolean | string;
}

export interface WorkerLens {
  name: string;
  prompt: string;
}

export interface WorkerResult {
  index: number;
  lens: string;
  ok: boolean;
  output: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  model: string | undefined;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    turns: number;
  };
}

export interface BypassInput {
  enabled: boolean;
  text: string;
  source: string | undefined;
  streamingBehavior: string | undefined;
  isIdle: boolean;
}

export const DEFAULT_SETTINGS: FusionSettings = {
  enabled: true,
  workerCount: 3,
  workerOutputBytes: 12_000,
  contextBytes: 16_000,
  timeoutMs: 600_000,
  model: undefined,
};

export const WORKER_LENSES: WorkerLens[] = [
  {
    name: "mapper",
    prompt:
      "Map the codebase surface area. Identify the files, symbols, commands, and existing patterns the actor should inspect before changing anything.",
  },
  {
    name: "planner",
    prompt:
      "Produce a minimal implementation plan. Prefer small, reversible changes and call out the exact verification command you would run.",
  },
  {
    name: "skeptic",
    prompt:
      "Look for risks, hidden requirements, edge cases, and likely failure modes. Suggest tests or manual checks that would catch them.",
  },
  {
    name: "simplifier",
    prompt:
      "Find the simplest path that could satisfy the request. Challenge unnecessary abstractions, broad rewrites, and speculative work.",
  },
];

export function parsePositiveInteger(
  value: boolean | string | number | undefined,
  fallback: number,
  options: { min: number; max: number },
): number {
  if (typeof value === "boolean" || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(options.min, Math.min(options.max, parsed));
}

export function resolveSettings(flags: FusionFlags = {}, persisted?: Partial<FusionSettings>): FusionSettings {
  const settings = { ...DEFAULT_SETTINGS, ...persisted };
  settings.enabled = persisted?.enabled ?? flags["fusion-disabled"] !== true;
  settings.workerCount = parsePositiveInteger(flags["fusion-workers"], settings.workerCount, { min: 1, max: 8 });
  settings.workerOutputBytes = parsePositiveInteger(flags["fusion-output-bytes"], settings.workerOutputBytes, {
    min: 1_000,
    max: 64_000,
  });
  settings.contextBytes = parsePositiveInteger(flags["fusion-context-bytes"], settings.contextBytes, {
    min: 0,
    max: 64_000,
  });
  settings.timeoutMs = parsePositiveInteger(flags["fusion-timeout-ms"], settings.timeoutMs, {
    min: 5_000,
    max: 3_600_000,
  });

  const flagModel = flags["fusion-model"];
  if (typeof flagModel === "string" && flagModel.trim()) settings.model = flagModel.trim();
  if (settings.model === "current" || settings.model === "default" || settings.model === "") settings.model = undefined;

  return settings;
}

export function shouldBypassFusion(input: BypassInput): string | undefined {
  const trimmed = input.text.trim();
  if (!input.enabled) return "disabled";
  if (!trimmed) return "empty input";
  if (input.source === "extension") return "extension-injected input";
  if (input.streamingBehavior) return "queued steering/follow-up input";
  if (!input.isIdle) return "agent is already running";
  if (trimmed.startsWith("/")) return "slash command or prompt template";
  if (trimmed.startsWith("!")) return "user bash command";
  if (input.text.includes(ACTOR_PROMPT_MARKER)) return "already fused";
  return undefined;
}

export function truncateUtf8(input: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(input, "utf8");
  if (bytes <= maxBytes) return input;

  let low = 0;
  let high = input.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(input.slice(0, mid), "utf8") <= maxBytes) low = mid;
    else high = mid - 1;
  }

  const omitted = bytes - Buffer.byteLength(input.slice(0, low), "utf8");
  return `${input.slice(0, low)}\n\n[pi-fusion truncated ${omitted} bytes]`;
}

export function getWorkerLens(index: number): WorkerLens {
  return WORKER_LENSES[index % WORKER_LENSES.length];
}

export function buildWorkerPrompt(input: {
  task: string;
  recentContext: string;
  cwd: string;
  workerIndex: number;
  workerCount: number;
  lens: WorkerLens;
}): string {
  const contextSection = input.recentContext.trim()
    ? `## Recent conversation context (truncated)\n\n${input.recentContext.trim()}\n\n`
    : "";

  return `You are worker ${input.workerIndex + 1}/${input.workerCount} in an LLM Fusion planning pass.

Your job is to spend tokens thinking and investigating before the main actor acts. You are read-only: do not modify files, do not propose tool calls that write files, and do not ask the user to approve changes. The only tools available to you should be read-only file/search tools.

Working directory: ${input.cwd}

${contextSection}## User request

${input.task.trim()}

## Planning lens: ${input.lens.name}

${input.lens.prompt}

## Output contract

Return concise markdown with these sections:

1. **Understanding** — what you think the user wants.
2. **Relevant context** — files, symbols, patterns, or commands you inspected or recommend inspecting.
3. **Plan** — concrete steps for the actor.
4. **Risks and verification** — edge cases, tests, or manual checks.

Keep the result useful for a downstream actor. Do not implement anything.`;
}

export function formatWorkerForActor(result: WorkerResult, maxBytes: number): string {
  const status = result.ok ? "completed" : result.timedOut ? "timed out" : `failed${result.exitCode === null ? "" : ` (${result.exitCode})`}`;
  const diagnostics = result.stderr.trim() && !result.ok ? `\n\nStderr:\n${truncateUtf8(result.stderr.trim(), 2_000)}` : "";
  const usage = result.usage.turns
    ? `\n\nUsage: ${result.usage.turns} turn(s), ↑${result.usage.input}, ↓${result.usage.output}, $${result.usage.cost.toFixed(4)}${result.model ? `, ${result.model}` : ""}`
    : result.model
      ? `\n\nModel: ${result.model}`
      : "";

  return `## Worker ${result.index + 1}: ${result.lens} — ${status}\n\n${truncateUtf8(result.output.trim() || "(no output)", maxBytes)}${diagnostics}${usage}`;
}

export function buildActorPrompt(input: {
  originalText: string;
  workerResults: WorkerResult[];
  workerOutputBytes: number;
  imageCount: number;
}): string {
  const workers = input.workerResults.map((result) => formatWorkerForActor(result, input.workerOutputBytes)).join("\n\n---\n\n");
  const imageNote = input.imageCount > 0 ? `\n\nNote: the user attached ${input.imageCount} image(s). Workers did not see images; inspect them yourself.` : "";

  return `${ACTOR_PROMPT_MARKER}
# LLM Fusion planning bundle

The user's original request is below. Several read-only workers independently explored/planned first. Synthesize their advice, verify anything important yourself, then act on the original request using your available tools. Treat worker output as advisory, not authoritative.${imageNote}

## Original user request

${input.originalText.trim()}

## Worker outputs

${workers || "(no worker output)"}

## Actor instructions

- Act on the original request, not on the workers' wording.
- Use the workers to reduce blind spots, but verify before editing or running risky commands.
- Keep your visible response natural; do not dump a long meta-synthesis unless the user asked for one.
- If worker plans disagree, choose the smallest safe path and mention the tradeoff only if useful.`;
}

function getContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && "type" in part && (part as { type?: unknown }).type === "text") {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function collectRecentConversation(entries: unknown[], maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const chunks: string[] = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type?: unknown; message?: { role?: unknown; content?: unknown } };
    if (entry.type !== "message" || !entry.message) continue;
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;

    const text = getContentText(entry.message.content).trim();
    if (!text || text.includes(ACTOR_PROMPT_MARKER)) continue;

    chunks.unshift(`### ${role}\n\n${text}`);
    const joined = chunks.join("\n\n");
    if (Buffer.byteLength(joined, "utf8") > maxBytes) {
      return truncateUtf8(joined, maxBytes);
    }
  }

  return chunks.join("\n\n");
}
