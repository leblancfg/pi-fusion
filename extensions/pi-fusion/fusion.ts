export const ACTOR_PROMPT_MARKER = "<!-- pi-fusion:actor-prompt -->";

export type FusionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type FusionThinkingChoice = "current" | FusionThinkingLevel;

export const THINKING_CHOICES: FusionThinkingChoice[] = ["current", "off", "minimal", "low", "medium", "high", "xhigh"];

export interface FusionWorker {
  model: string | undefined;
  thinking: FusionThinkingLevel | undefined;
}

export interface FusionSettings {
  enabled: boolean;
  workerCount: number;
  workers: FusionWorker[];
  workerOutputBytes: number;
  contextBytes: number;
  timeoutMs: number;
  discoveryModel: string | undefined;
  workerModel: string | undefined;
  synthesizerModel: string | undefined;
  discoveryThinking: FusionThinkingLevel | undefined;
  workerThinking: FusionThinkingLevel | undefined;
  synthesizerThinking: FusionThinkingLevel | undefined;
}

export interface PersistedFusionSettings extends Partial<FusionSettings> {
  model?: string;
}

export interface FusionFlags {
  "fusion-disabled"?: boolean | string;
  "fusion-workers"?: boolean | string;
  "fusion-output-bytes"?: boolean | string;
  "fusion-context-bytes"?: boolean | string;
  "fusion-timeout-ms"?: boolean | string;
  "fusion-model"?: boolean | string;
  "fusion-discovery-model"?: boolean | string;
  "fusion-worker-model"?: boolean | string;
  "fusion-synthesizer-model"?: boolean | string;
  "fusion-discovery-thinking"?: boolean | string;
  "fusion-worker-thinking"?: boolean | string;
  "fusion-synthesizer-thinking"?: boolean | string;
}

export interface WorkerLens {
  name: string;
}

export interface WorkerResult {
  index: number;
  lens: string;
  ok: boolean;
  output: string;
  reasoning: string;
  toolContext: string;
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
  workers: [],
  workerOutputBytes: 12_000,
  contextBytes: 16_000,
  timeoutMs: 600_000,
  discoveryModel: undefined,
  workerModel: undefined,
  synthesizerModel: undefined,
  discoveryThinking: undefined,
  workerThinking: undefined,
  synthesizerThinking: undefined,
};

export function parsePositiveInteger(value: boolean | string | number | undefined, fallback: number, options: { min: number; max: number }): number {
  if (typeof value === "boolean" || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(options.min, Math.min(options.max, parsed));
}

function normalizeModelSpec(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "current" || trimmed === "default") return undefined;
  return trimmed;
}

export function normalizeThinkingChoice(value: string | undefined): FusionThinkingLevel | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "current" || trimmed === "default") return undefined;
  return THINKING_CHOICES.includes(trimmed as FusionThinkingChoice) && trimmed !== "current" ? (trimmed as FusionThinkingLevel) : undefined;
}

export function normalizeWorkerSlots(workers: FusionWorker[] | undefined, count: number): FusionWorker[] {
  const base = workers ?? [];
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    model: normalizeModelSpec(base[index]?.model),
    thinking: normalizeThinkingChoice(base[index]?.thinking),
  }));
}

export function resolveWorkerModel(settings: FusionSettings, index: number, fallback: string | undefined): string | undefined {
  return settings.workers[index]?.model ?? settings.workerModel ?? fallback;
}

export function resolveWorkerThinking(
  settings: FusionSettings,
  index: number,
  fallback: FusionThinkingLevel | undefined,
): FusionThinkingLevel | undefined {
  return settings.workers[index]?.thinking ?? settings.workerThinking ?? fallback;
}

export function resolveSettings(flags: FusionFlags = {}, persisted?: PersistedFusionSettings): FusionSettings {
  const persistedWithoutLegacy = persisted ? { ...persisted } : undefined;
  delete persistedWithoutLegacy?.model;

  const settings = { ...DEFAULT_SETTINGS, ...persistedWithoutLegacy };
  settings.workerModel = settings.workerModel ?? normalizeModelSpec(persisted?.model);
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

  const discoveryModelFlag = flags["fusion-discovery-model"];
  const workerModelFlag = flags["fusion-worker-model"] ?? flags["fusion-model"];
  const synthesizerModelFlag = flags["fusion-synthesizer-model"];
  const discoveryThinkingFlag = flags["fusion-discovery-thinking"];
  const workerThinkingFlag = flags["fusion-worker-thinking"];
  const synthesizerThinkingFlag = flags["fusion-synthesizer-thinking"];
  if (typeof discoveryModelFlag === "string") settings.discoveryModel = normalizeModelSpec(discoveryModelFlag);
  if (typeof workerModelFlag === "string") settings.workerModel = normalizeModelSpec(workerModelFlag);
  if (typeof synthesizerModelFlag === "string") settings.synthesizerModel = normalizeModelSpec(synthesizerModelFlag);
  if (typeof discoveryThinkingFlag === "string") settings.discoveryThinking = normalizeThinkingChoice(discoveryThinkingFlag);
  if (typeof workerThinkingFlag === "string") settings.workerThinking = normalizeThinkingChoice(workerThinkingFlag);
  if (typeof synthesizerThinkingFlag === "string") settings.synthesizerThinking = normalizeThinkingChoice(synthesizerThinkingFlag);
  settings.discoveryModel = normalizeModelSpec(settings.discoveryModel);
  settings.workerModel = normalizeModelSpec(settings.workerModel);
  settings.synthesizerModel = normalizeModelSpec(settings.synthesizerModel);
  settings.discoveryThinking = normalizeThinkingChoice(settings.discoveryThinking);
  settings.workerThinking = normalizeThinkingChoice(settings.workerThinking);
  settings.synthesizerThinking = normalizeThinkingChoice(settings.synthesizerThinking);
  settings.workers = normalizeWorkerSlots(settings.workers, settings.workerCount);

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
  return { name: `#${index + 1}` };
}

export function buildDiscoveryPrompt(input: { task: string; recentContext: string; cwd: string }): string {
  const contextSection = input.recentContext.trim() ? `## Recent conversation context (truncated)\n\n${input.recentContext.trim()}\n\n` : "";

  return `You are the discovery agent in an LLM Fusion pipeline.

Your only job is to load context for the rest of the team. Spend read/search/list tool calls to surface the files, symbols, APIs, commands, and snippets that look relevant to the request, so downstream workers and the synthesizer can work from shared context instead of repeating your exploration.

This is a mechanical gathering step, not an analysis step. Do not answer the user's request, solve the problem, plan an implementation, assess or rank relevance, judge quality, or make any recommendation. Do not offer opinions or conclusions of any kind — they would bias the workers. Do not edit files. When you have gathered the context, stop.

Working directory: ${input.cwd}

${contextSection}## User request to gather context for

${input.task.trim()}

## Output contract

Return a context handoff in markdown with:

1. **Context loaded** — the files, symbols, APIs, commands, snippets, and search results you inspected, with concrete paths/line ranges and a neutral one-line note of what each contains (not why it matters or whether it is useful).
2. **Gaps** — relevant context you could not load, if any.

State facts only. Include enough detail that workers and the synthesizer can avoid re-reading the same files. Then stop.`;
}

export function buildRewritePrompt(input: { task: string; recentContext: string; workerCount: number }): string {
  const contextSection = input.recentContext.trim()
    ? `## Recent conversation context (truncated)\n\n${truncateUtf8(input.recentContext.trim(), 8_000)}\n\n`
    : "";

  return `Rewrite the user's request into ${input.workerCount} complementary exploration prompts for parallel planning workers.

This is query rewriting, similar to RAG query expansion. The rewrites should explore the idea space from different useful angles without assigning named personas. Keep them specific and grounded in the original request and the recent context.

## User request

${input.task.trim()}

${contextSection}## Output contract

Return only a JSON array of ${input.workerCount} strings. No markdown, no explanation.`;
}

export function parsePromptVariations(output: string, workerCount: number, fallbackTask: string): string[] {
  const count = Math.max(1, workerCount);
  const trimmed = output
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  const fill = (variations: string[]): string[] =>
    Array.from({ length: count }, (_, index) => variations[index] ?? variations[variations.length - 1] ?? fallbackTask);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const variations = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
      if (variations.length > 0) return fill(variations);
    }
  } catch {
    // Fall back to numbered/plain-line parsing below.
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  return fill(lines.length > 0 ? lines : [fallbackTask]);
}

export function buildWorkerPrompt(input: {
  task: string;
  assignedPrompt: string;
  recentContext: string;
  discoveryContext: string;
  cwd: string;
  lens: WorkerLens;
}): string {
  const discoverySection = input.discoveryContext.trim() ? `## Shared discovery context\n\n${input.discoveryContext.trim()}\n\n` : "";
  const recentSection = input.recentContext.trim() ? `## Recent conversation context (truncated)\n\n${input.recentContext.trim()}\n\n` : "";

  return `${discoverySection}You are worker ${input.lens.name} in an LLM Fusion planning pass.

Your job is to think and investigate before the main actor acts. You are read-only: do not modify files, do not propose tool calls that write files, and do not ask the user to approve changes. The shared discovery context above is loaded for you; use it before making tool calls. Only read/search more when it adds missing information, verifies uncertainty, or inspects files not already present.

Working directory: ${input.cwd}

${recentSection}## Original user request

${input.task.trim()}

## Assigned rewritten exploration prompt

${input.assignedPrompt.trim()}

## Output contract

Return concise markdown with these sections:

1. **Understanding** — what this exploration prompt means for the original request.
2. **Additional context** — only new files, symbols, patterns, or commands beyond discovery.
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
  discoveryContext: string;
  promptVariations: string[];
  workerResults: WorkerResult[];
  workerOutputBytes: number;
  imageCount: number;
}): string {
  const workers = input.workerResults.map((result) => formatWorkerForActor(result, input.workerOutputBytes)).join("\n\n---\n\n");
  const imageNote =
    input.imageCount > 0 ? `\n\nNote: the user attached ${input.imageCount} image(s). Workers did not see images; inspect them yourself.` : "";
  const discovery = input.discoveryContext.trim() ? `## Shared discovery context\n\n${truncateUtf8(input.discoveryContext.trim(), 64_000)}\n\n` : "";
  const variations =
    input.promptVariations.length > 0
      ? `\n\n## Worker prompt variations\n\n${input.promptVariations.map((variation, index) => `${index + 1}. ${variation}`).join("\n")}`
      : "";

  return `${ACTOR_PROMPT_MARKER}
${discovery}# LLM Fusion planning bundle

A discovery agent gathered the shared context above, a query-rewrite pass generated worker prompts, and read-only workers independently explored/planned. Synthesize their advice, verify anything important yourself, then act on the original request using your available tools. Treat all subagent output as advisory, not authoritative.${imageNote}

## Original user request

${input.originalText.trim()}${variations}

## Worker outputs

${workers || "(no worker output)"}

## Actor instructions

- Act on the original request, not on the workers' wording.
- Use shared discovery context before re-reading files; avoid redundant tool calls unless verification or missing context requires them.
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
