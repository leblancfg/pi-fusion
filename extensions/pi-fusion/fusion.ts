export const SYNTHESIS_PROMPT_MARKER = "<!-- pi-fusion:synthesis-prompt -->";
// TODO(2026-07-17): remove legacy marker once in-flight sessions/configs have migrated off "actor".
export const LEGACY_SYNTHESIS_PROMPT_MARKER = "<!-- pi-fusion:actor-prompt -->";

export type FusionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type FusionThinkingChoice = "current" | FusionThinkingLevel;
export type FusionPlannerToolMode = "all" | "read-only";

export const THINKING_CHOICES: FusionThinkingChoice[] = ["current", "off", "minimal", "low", "medium", "high", "xhigh"];
export const PLANNER_TOOL_MODES: FusionPlannerToolMode[] = ["all", "read-only"];

export interface FusionWorker {
  model: string | undefined;
  thinking: FusionThinkingLevel | undefined;
}

export interface FusionSettings {
  enabled: boolean;
  discoveryEnabled: boolean;
  rewriteEnabled: boolean;
  workerCount: number;
  workers: FusionWorker[];
  workerOutputBytes: number;
  contextBytes: number;
  resumeContextBytes: number;
  timeoutMs: number;
  discoveryModel: string | undefined;
  workerModel: string | undefined;
  synthesisModel: string | undefined;
  discoveryThinking: FusionThinkingLevel | undefined;
  workerThinking: FusionThinkingLevel | undefined;
  synthesisThinking: FusionThinkingLevel | undefined;
  plannerToolMode: FusionPlannerToolMode;
  preset?: string;
}

export interface PersistedFusionSettings extends Partial<FusionSettings> {
  model?: string;
  // TODO(2026-07-17): remove legacy synthesizer* keys once persisted sessions/presets have migrated to synthesis*.
  synthesizerModel?: string;
  synthesizerThinking?: FusionThinkingLevel;
}

export interface FusionFlags {
  "fusion-enabled"?: boolean | string;
  "fusion-disabled"?: boolean | string;
  "fusion-no-discovery"?: boolean | string;
  "fusion-no-rewrite"?: boolean | string;
  "fusion-workers"?: boolean | string;
  "fusion-output-bytes"?: boolean | string;
  "fusion-context-bytes"?: boolean | string;
  "fusion-resume-bytes"?: boolean | string;
  "fusion-timeout-ms"?: boolean | string;
  "fusion-model"?: boolean | string;
  "fusion-discovery-model"?: boolean | string;
  "fusion-worker-model"?: boolean | string;
  "fusion-synthesis-model"?: boolean | string;
  "fusion-discovery-thinking"?: boolean | string;
  "fusion-worker-thinking"?: boolean | string;
  "fusion-synthesis-thinking"?: boolean | string;
  "fusion-planner-tools"?: boolean | string;
  "fusion-preset"?: boolean | string;
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

export interface FusionTraceResult {
  label: string;
  lens: string;
  status: string;
  ok: boolean;
  model: string | undefined;
  prompt?: string;
  output: string;
  reasoning: string;
  toolContext: string;
  stderr: string;
  usage: WorkerResult["usage"];
}

export interface FusionTraceDetails {
  task: string;
  discoveryEnabled: boolean;
  rewriteEnabled: boolean;
  promptVariations: string[];
  discovery?: FusionTraceResult;
  rewrite?: FusionTraceResult;
  workers: FusionTraceResult[];
  /** Run id linking this trace to its full archive entries (if archived). */
  runId?: string;
  /** Number of archive chunk entries persisted for this run. */
  archiveChunks?: number;
  /** Total byte size of the full archive transcript. */
  archiveBytes?: number;
}

export interface FusionTraceMessage {
  customType: typeof FUSION_TRACE_MESSAGE_TYPE;
  content: string;
  display: true;
  details: FusionTraceDetails;
}

export interface BypassInput {
  enabled: boolean;
  text: string;
  source: string | undefined;
  streamingBehavior: string | undefined;
  isIdle: boolean;
}

export const DEFAULT_SETTINGS: FusionSettings = {
  enabled: false,
  discoveryEnabled: true,
  rewriteEnabled: true,
  workerCount: 3,
  workers: [],
  workerOutputBytes: 12_000,
  contextBytes: 16_000,
  resumeContextBytes: 8_000,
  timeoutMs: 600_000,
  discoveryModel: undefined,
  workerModel: undefined,
  synthesisModel: undefined,
  discoveryThinking: undefined,
  workerThinking: undefined,
  synthesisThinking: undefined,
  plannerToolMode: "all",
  preset: undefined,
};

export function parsePositiveInteger(value: boolean | string | number | undefined, fallback: number, options: { min: number; max: number }): number {
  if (typeof value === "boolean" || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(options.min, Math.min(options.max, parsed));
}

function normalizeModelSpec(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "current" || trimmed === "default") return undefined;
  return trimmed;
}

export function normalizeThinkingChoice(value: unknown): FusionThinkingLevel | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "current" || trimmed === "default") return undefined;
  return THINKING_CHOICES.includes(trimmed as FusionThinkingChoice) && trimmed !== "current" ? (trimmed as FusionThinkingLevel) : undefined;
}

export function normalizePlannerToolMode(value: unknown, fallback: FusionPlannerToolMode = DEFAULT_SETTINGS.plannerToolMode): FusionPlannerToolMode {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "readonly" || normalized === "read-only") return "read-only";
  if (normalized === "all") return "all";
  return fallback;
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

export function consumeNextTurnFusion(settings: FusionSettings): boolean {
  if (!settings.enabled) return false;
  settings.enabled = false;
  return true;
}

export const FUSION_STATUS_OFF = "∪\u0338";
export const FUSION_STATUS_ON = "∪";
export const FUSION_TRACE_MESSAGE_TYPE = "pi-fusion-run";

export function fusionStatusGlyph(enabled: boolean): string {
  return enabled ? FUSION_STATUS_ON : FUSION_STATUS_OFF;
}

export function resolveSettings(flags: FusionFlags = {}, persisted?: PersistedFusionSettings): FusionSettings {
  const persistedWithoutLegacy = persisted ? { ...persisted } : undefined;
  delete persistedWithoutLegacy?.model;

  const settings = { ...DEFAULT_SETTINGS, ...persistedWithoutLegacy };
  settings.workerModel = settings.workerModel ?? normalizeModelSpec(persisted?.model);
  // TODO(2026-07-17): remove legacy synthesizer* migration once persisted sessions/presets have moved to synthesis*.
  settings.synthesisModel = settings.synthesisModel ?? normalizeModelSpec(persisted?.synthesizerModel);
  settings.synthesisThinking = settings.synthesisThinking ?? normalizeThinkingChoice(persisted?.synthesizerThinking);

  // Opt-in by default: fusion is off unless armed via --fusion-enabled, a
  // persisted /fusion on, or the settings pane. --fusion-disabled forces off.
  settings.enabled = flags["fusion-disabled"] === true ? false : (persisted?.enabled ?? flags["fusion-enabled"] === true);
  // Discovery and rewrite are on by default; --fusion-no-discovery/--fusion-no-rewrite turn them off.
  settings.discoveryEnabled = persisted?.discoveryEnabled ?? flags["fusion-no-discovery"] !== true;
  settings.rewriteEnabled = persisted?.rewriteEnabled ?? flags["fusion-no-rewrite"] !== true;
  settings.plannerToolMode = normalizePlannerToolMode(settings.plannerToolMode);
  if (flags["fusion-planner-tools"] !== undefined) {
    settings.plannerToolMode = normalizePlannerToolMode(flags["fusion-planner-tools"], settings.plannerToolMode);
  }
  if (flags["fusion-workers"] !== undefined) {
    settings.workerCount = parsePositiveInteger(flags["fusion-workers"], settings.workerCount, { min: 1, max: 8 });
  } else {
    settings.workerCount = parsePositiveInteger(String(settings.workerCount), settings.workerCount, { min: 1, max: 8 });
  }
  settings.workerOutputBytes = parsePositiveInteger(flags["fusion-output-bytes"], settings.workerOutputBytes, {
    min: 1_000,
    max: 64_000,
  });
  settings.contextBytes = parsePositiveInteger(flags["fusion-context-bytes"], settings.contextBytes, {
    min: 0,
    max: 64_000,
  });
  settings.resumeContextBytes = parsePositiveInteger(flags["fusion-resume-bytes"], settings.resumeContextBytes, {
    min: 0,
    max: 64_000,
  });
  settings.timeoutMs = parsePositiveInteger(flags["fusion-timeout-ms"], settings.timeoutMs, {
    min: 5_000,
    max: 3_600_000,
  });

  const discoveryModelFlag = flags["fusion-discovery-model"];
  const workerModelFlag = flags["fusion-worker-model"] ?? flags["fusion-model"];
  const synthesisModelFlag = flags["fusion-synthesis-model"];
  const discoveryThinkingFlag = flags["fusion-discovery-thinking"];
  const workerThinkingFlag = flags["fusion-worker-thinking"];
  const synthesisThinkingFlag = flags["fusion-synthesis-thinking"];
  if (typeof discoveryModelFlag === "string") settings.discoveryModel = normalizeModelSpec(discoveryModelFlag);
  if (typeof workerModelFlag === "string") settings.workerModel = normalizeModelSpec(workerModelFlag);
  if (typeof synthesisModelFlag === "string") settings.synthesisModel = normalizeModelSpec(synthesisModelFlag);
  if (typeof discoveryThinkingFlag === "string") settings.discoveryThinking = normalizeThinkingChoice(discoveryThinkingFlag);
  if (typeof workerThinkingFlag === "string") settings.workerThinking = normalizeThinkingChoice(workerThinkingFlag);
  if (typeof synthesisThinkingFlag === "string") settings.synthesisThinking = normalizeThinkingChoice(synthesisThinkingFlag);
  settings.discoveryModel = normalizeModelSpec(settings.discoveryModel);
  settings.workerModel = normalizeModelSpec(settings.workerModel);
  settings.synthesisModel = normalizeModelSpec(settings.synthesisModel);
  settings.discoveryThinking = normalizeThinkingChoice(settings.discoveryThinking);
  settings.workerThinking = normalizeThinkingChoice(settings.workerThinking);
  settings.synthesisThinking = normalizeThinkingChoice(settings.synthesisThinking);
  settings.plannerToolMode = normalizePlannerToolMode(settings.plannerToolMode);
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
  if (input.text.includes(SYNTHESIS_PROMPT_MARKER) || input.text.includes(LEGACY_SYNTHESIS_PROMPT_MARKER)) return "already fused";
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

// Preview budgets for the in-context custom_message details. These are bounded
// on purpose: the full, untruncated transcript lives in the archive entries
// (see buildFusionArchive), not here. A budget of 0 omits the section.
const TRACE_TASK_BYTES = 2_000;
const TRACE_PROMPT_BYTES = 1_000;
const TRACE_REASONING_BYTES = 0;
const TRACE_OUTPUT_BYTES = 2_000;
const TRACE_TOOL_CONTEXT_BYTES = 0;
const TRACE_STDERR_BYTES = 1_000;

function preview(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  return truncateUtf8(text.trim(), maxBytes);
}

function workerStatus(result: WorkerResult): string {
  if (result.ok) return "completed";
  if (result.timedOut) return "timed out";
  return `failed${result.exitCode === null ? "" : ` (${result.exitCode})`}`;
}

function traceResult(label: string, result: WorkerResult, prompt?: string): FusionTraceResult {
  return {
    label,
    lens: result.lens,
    status: workerStatus(result),
    ok: result.ok,
    model: result.model,
    prompt: prompt ? preview(prompt, TRACE_PROMPT_BYTES) : undefined,
    output: preview(result.output || "(no output)", TRACE_OUTPUT_BYTES) || "(no output)",
    reasoning: preview(result.reasoning, TRACE_REASONING_BYTES),
    toolContext: preview(result.toolContext, TRACE_TOOL_CONTEXT_BYTES),
    stderr: preview(result.stderr, TRACE_STDERR_BYTES),
    usage: result.usage,
  };
}

function formatTraceUsage(result: FusionTraceResult): string {
  const usage = result.usage;
  const parts = [`status: ${result.status}`];
  if (result.model) parts.push(`model: ${result.model}`);
  if (usage.turns > 0) parts.push(`turns: ${usage.turns}`, `tokens: ↑${usage.input} ↓${usage.output}`);
  if (usage.cacheRead > 0 || usage.cacheWrite > 0) parts.push(`cache: read ${usage.cacheRead} write ${usage.cacheWrite}`);
  if (usage.cost > 0) parts.push(`cost: $${usage.cost.toFixed(4)}`);
  return parts.join(" • ");
}

function formatTraceResult(result: FusionTraceResult): string {
  return [
    `## ${result.label}`,
    formatTraceUsage(result),
    result.prompt ? `\n### prompt\n${result.prompt}` : "",
    result.reasoning ? `\n### reasoning\n${result.reasoning}` : "",
    `\n### output\n${result.output}`,
    result.toolContext ? `\n### tool context\n${result.toolContext}` : "",
    result.stderr ? `\n### stderr\n${result.stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function looksLikeFusionTraceDetails(details: unknown): details is FusionTraceDetails {
  if (!details || typeof details !== "object") return false;
  const candidate = details as Partial<FusionTraceDetails>;
  return typeof candidate.task === "string" && Array.isArray(candidate.workers) && Array.isArray(candidate.promptVariations);
}

function discoveryStatusLabel(result?: WorkerResult): string {
  if (!result) return "discovery skipped";
  return result.ok ? "discovery completed" : `discovery ${workerStatus(result)}`;
}

function rewriteStatusLabel(result?: WorkerResult): string {
  if (!result) return "rewrite skipped";
  return result.ok ? "rewrite completed" : `rewrite ${workerStatus(result)}`;
}

/**
 * Builds the model-visible handoff stored in custom_message.content.
 *
 * This is deliberately bounded by maxBytes: it is what resumed and subsequent
 * turns see. The full, untruncated sub-agent transcript is archived separately
 * via buildFusionArchive and is kept out of LLM context.
 */
export function buildResumeHandoff(input: {
  runId?: string;
  discoveryStatus: string;
  rewriteStatus: string;
  completedWorkers: number;
  totalWorkers: number;
  workerResults: WorkerResult[];
  maxBytes: number;
}): string {
  const headline = `∪ pi-fusion transcript: ${input.discoveryStatus}; ${input.rewriteStatus}; ${input.completedWorkers}/${input.totalWorkers} workers completed.`;
  const pointer = input.runId
    ? `Parallel sub-agents produced this answer. Their full transcripts are archived in this pi session (run ${input.runId}) and are intentionally kept out of context. Run \`/fusion-transcript ${input.runId}\` to inspect them.`
    : "Parallel sub-agents produced this answer; their full transcripts are kept out of context.";

  if (input.maxBytes <= 0 || input.workerResults.length === 0) {
    return `${headline}\n\n${pointer}`;
  }

  const conclusions = input.workerResults
    .map((result, index) => {
      const status = result.ok ? "" : ` (${workerStatus(result)})`;
      const body = result.output.trim() || "(no output)";
      return `### worker ${index + 1}: ${result.lens}${status}\n${body}`;
    })
    .join("\n\n");
  const bounded = truncateUtf8(conclusions, input.maxBytes);
  return `${headline}\n\n${pointer}\n\n## Worker conclusions\n${bounded}`;
}

export function buildFusionTraceMessage(input: {
  task: string;
  discoveryEnabled: boolean;
  rewriteEnabled: boolean;
  promptVariations: string[];
  discoveryResult?: WorkerResult;
  rewriteResult?: WorkerResult;
  workerResults: WorkerResult[];
  runId?: string;
  archiveChunks?: number;
  archiveBytes?: number;
  resumeContextBytes?: number;
}): FusionTraceMessage {
  const completedWorkers = input.workerResults.filter((result) => result.ok).length;
  const discoveryStatus = discoveryStatusLabel(input.discoveryResult);
  const rewriteStatus = rewriteStatusLabel(input.rewriteResult);

  return {
    customType: FUSION_TRACE_MESSAGE_TYPE,
    content: buildResumeHandoff({
      runId: input.runId,
      discoveryStatus,
      rewriteStatus,
      completedWorkers,
      totalWorkers: input.workerResults.length,
      workerResults: input.workerResults,
      maxBytes: input.resumeContextBytes ?? DEFAULT_SETTINGS.resumeContextBytes,
    }),
    display: true,
    details: {
      task: truncateUtf8(input.task.trim(), TRACE_TASK_BYTES),
      discoveryEnabled: input.discoveryEnabled,
      rewriteEnabled: input.rewriteEnabled,
      promptVariations: input.promptVariations.map((prompt) => truncateUtf8(prompt.trim(), TRACE_PROMPT_BYTES)),
      discovery: input.discoveryResult ? traceResult("discovery", input.discoveryResult) : undefined,
      rewrite: input.rewriteResult ? traceResult("rewrite", input.rewriteResult) : undefined,
      workers: input.workerResults.map((result, index) => traceResult(`worker ${index + 1}: ${result.lens}`, result, input.promptVariations[index])),
      runId: input.runId,
      archiveChunks: input.archiveChunks,
      archiveBytes: input.archiveBytes,
    },
  };
}

export function formatFusionTraceDetails(details: unknown): string {
  if (!looksLikeFusionTraceDetails(details)) return "No pi-fusion transcript details are available for this message.";
  const prompts = details.promptVariations.length
    ? `## worker prompt variations\n${details.promptVariations.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n\n")}`
    : "";

  const archiveNote = details.runId
    ? `Previews below are truncated. Full untruncated transcript archived in this session (run ${details.runId}, ${details.archiveChunks ?? 0} chunk(s), ${details.archiveBytes ?? 0} bytes). Run \`/fusion-transcript ${details.runId}\` for the complete archive.`
    : "Previews below are truncated.";

  return [
    "# pi-fusion transcript",
    `discovery: ${details.discoveryEnabled ? "on" : "off"} • rewrite: ${details.rewriteEnabled ? "on" : "off"} • workers: ${details.workers.length}`,
    archiveNote,
    `\n## original request\n${details.task || "(empty)"}`,
    prompts,
    details.discovery ? formatTraceResult(details.discovery) : "",
    details.rewrite ? formatTraceResult(details.rewrite) : "",
    ...details.workers.map((result) => formatTraceResult(result)),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** First line of a handoff/trace content string, for compact (collapsed) rendering. */
export function fusionTraceHeadline(content: string): string {
  return content.split("\n", 1)[0] ?? content;
}

// =============================================================================
// Archive: full sub-agent transcripts persisted as non-context `custom` entries.
//
// The archive is the durable, auditable record of everything the discovery,
// rewrite, and worker sub-agents produced. It is stored as session `custom`
// entries (FUSION_ARCHIVE_ENTRY_TYPE) which pi's buildSessionContext() never
// feeds to the LLM, so it can be full-fidelity without inflating context.
// The transcript is chunked only to keep individual session lines reasonable;
// chunking is byte-exact and reversible, never a semantic truncation.
// =============================================================================

export const FUSION_ARCHIVE_ENTRY_TYPE = "pi-fusion-archive";
export const FUSION_ARCHIVE_SCHEMA = "pi-fusion.archive.v1";
export const FUSION_ARCHIVE_CHUNK_BYTES = 48_000;

export interface FusionArchiveManifest {
  schema: typeof FUSION_ARCHIVE_SCHEMA;
  kind: "manifest";
  runId: string;
  createdAt: string;
  task: string;
  discoveryEnabled: boolean;
  rewriteEnabled: boolean;
  workerCount: number;
  completedWorkers: number;
  chunks: number;
  bytes: number;
}

export interface FusionArchiveChunk {
  schema: typeof FUSION_ARCHIVE_SCHEMA;
  kind: "chunk";
  runId: string;
  index: number;
  total: number;
  content: string;
}

export type FusionArchiveEntry = FusionArchiveManifest | FusionArchiveChunk;

export interface FusionArchiveInput {
  runId: string;
  createdAt?: string;
  task: string;
  discoveryEnabled: boolean;
  rewriteEnabled: boolean;
  promptVariations: string[];
  discoveryResult?: WorkerResult;
  rewriteResult?: WorkerResult;
  workerResults: WorkerResult[];
}

/**
 * Splits a string into chunks no larger than maxBytes (UTF-8), never splitting
 * a multi-byte code point. join(chunkUtf8(s, n)) === s for any s.
 */
export function chunkUtf8(input: string, maxBytes: number): string[] {
  if (maxBytes <= 0 || Buffer.byteLength(input, "utf8") <= maxBytes) return [input];
  const chunks: string[] = [];
  let rest = input;
  while (Buffer.byteLength(rest, "utf8") > maxBytes) {
    let low = 0;
    let high = rest.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(rest.slice(0, mid), "utf8") <= maxBytes) low = mid;
      else high = mid - 1;
    }
    const cut = Math.max(1, low);
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

function archiveSection(label: string, result: WorkerResult, prompt?: string): string {
  return [
    `## ${label}`,
    formatTraceUsage(traceResultForArchive(label, result)),
    prompt ? `\n### prompt\n${prompt.trim()}` : "",
    result.reasoning.trim() ? `\n### reasoning\n${result.reasoning.trim()}` : "",
    `\n### output\n${result.output.trim() || "(no output)"}`,
    result.toolContext.trim() ? `\n### tool context\n${result.toolContext.trim()}` : "",
    result.stderr.trim() ? `\n### stderr\n${result.stderr.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Usage line reuses the trace formatter but must not truncate any payload.
function traceResultForArchive(label: string, result: WorkerResult): FusionTraceResult {
  return {
    label,
    lens: result.lens,
    status: workerStatus(result),
    ok: result.ok,
    model: result.model,
    output: result.output,
    reasoning: result.reasoning,
    toolContext: result.toolContext,
    stderr: result.stderr,
    usage: result.usage,
  };
}

/** Renders the full, untruncated transcript for a fusion run as markdown. */
export function buildFusionArchive(input: FusionArchiveInput): string {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const completedWorkers = input.workerResults.filter((result) => result.ok).length;
  const variations = input.promptVariations.length
    ? `## Worker prompt variations\n${input.promptVariations.map((prompt, index) => `${index + 1}. ${prompt.trim()}`).join("\n\n")}`
    : "";

  return [
    `# pi-fusion run ${input.runId}`,
    [
      `- created: ${createdAt}`,
      `- discovery: ${input.discoveryEnabled ? "on" : "off"} • rewrite: ${input.rewriteEnabled ? "on" : "off"}`,
      `- workers: ${completedWorkers}/${input.workerResults.length} completed`,
    ].join("\n"),
    `## Original request\n${input.task.trim() || "(empty)"}`,
    variations,
    input.discoveryResult ? archiveSection("Discovery", input.discoveryResult) : "",
    input.rewriteResult ? archiveSection("Rewrite", input.rewriteResult) : "",
    ...input.workerResults.map((result, index) => archiveSection(`Worker ${index + 1}: ${result.lens}`, result, input.promptVariations[index])),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Builds the manifest + chunk payloads for persisting a run's full archive. */
export function buildFusionArchiveEntries(input: FusionArchiveInput): {
  manifest: FusionArchiveManifest;
  chunks: FusionArchiveChunk[];
} {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const transcript = buildFusionArchive({ ...input, createdAt });
  const pieces = chunkUtf8(transcript, FUSION_ARCHIVE_CHUNK_BYTES);
  const chunks: FusionArchiveChunk[] = pieces.map((content, index) => ({
    schema: FUSION_ARCHIVE_SCHEMA,
    kind: "chunk",
    runId: input.runId,
    index,
    total: pieces.length,
    content,
  }));
  const manifest: FusionArchiveManifest = {
    schema: FUSION_ARCHIVE_SCHEMA,
    kind: "manifest",
    runId: input.runId,
    createdAt,
    task: input.task.trim(),
    discoveryEnabled: input.discoveryEnabled,
    rewriteEnabled: input.rewriteEnabled,
    workerCount: input.workerResults.length,
    completedWorkers: input.workerResults.filter((result) => result.ok).length,
    chunks: pieces.length,
    bytes: Buffer.byteLength(transcript, "utf8"),
  };
  return { manifest, chunks };
}

function asArchiveEntryData(entry: unknown): FusionArchiveEntry | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
  if (candidate.type !== "custom" || candidate.customType !== FUSION_ARCHIVE_ENTRY_TYPE) return undefined;
  const data = candidate.data as Partial<FusionArchiveEntry> | undefined;
  if (!data || typeof data !== "object" || data.schema !== FUSION_ARCHIVE_SCHEMA) return undefined;
  if (data.kind !== "manifest" && data.kind !== "chunk") return undefined;
  return data as FusionArchiveEntry;
}

/**
 * Rebuilds a run's full transcript from session entries. Without runId, returns
 * the most recent archived run. Returns undefined if no complete archive exists.
 */
export function reconstructFusionArchive(entries: unknown[], runId?: string): { manifest: FusionArchiveManifest; content: string } | undefined {
  const manifests: FusionArchiveManifest[] = [];
  const chunksByRun = new Map<string, FusionArchiveChunk[]>();
  for (const entry of entries) {
    const data = asArchiveEntryData(entry);
    if (!data) continue;
    if (data.kind === "manifest") {
      manifests.push(data);
    } else {
      const list = chunksByRun.get(data.runId) ?? [];
      list.push(data);
      chunksByRun.set(data.runId, list);
    }
  }

  const manifest = runId ? [...manifests].reverse().find((item) => item.runId === runId) : manifests[manifests.length - 1];
  if (!manifest) return undefined;

  const chunks = (chunksByRun.get(manifest.runId) ?? []).slice().sort((a, b) => a.index - b.index);
  if (chunks.length === 0) return undefined;
  const content = chunks.map((chunk) => chunk.content).join("");
  return { manifest, content };
}

export function listFusionArchiveRuns(entries: unknown[]): FusionArchiveManifest[] {
  const manifests: FusionArchiveManifest[] = [];
  for (const entry of entries) {
    const data = asArchiveEntryData(entry);
    if (data?.kind === "manifest") manifests.push(data);
  }
  return manifests;
}

/** Stable, sortable run id, e.g. fusion-20260617-153012-a1b2c3. */
export function createFusionRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").replace(/\..*$/, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `fusion-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${rand}`;
}

export function getWorkerLens(index: number): WorkerLens {
  return { name: `#${index + 1}` };
}

export function formatToolEvent(toolName: string, args: unknown, home?: string): string {
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const asString = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));
  const shorten = (path: string): string => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path);

  switch (toolName) {
    case "read": {
      const path = shorten(asString(record.path ?? record.file_path));
      const offset = record.offset;
      const limit = record.limit;
      const range = typeof offset === "number" ? `:${offset}${typeof limit === "number" ? `-${offset + limit - 1}` : ""}` : "";
      return `read ${path}${range}`.trimEnd();
    }
    case "ls":
      return `ls ${shorten(asString(record.path) || ".")}`.trimEnd();
    case "grep": {
      const pattern = asString(record.pattern);
      const path = shorten(asString(record.path));
      return `grep ${pattern ? `/${pattern}/` : ""}${path ? ` ${path}` : ""}`.replace(/\s+/g, " ").trim();
    }
    case "find": {
      const pattern = asString(record.pattern) || "*";
      const path = shorten(asString(record.path));
      return `find ${pattern}${path ? ` ${path}` : ""}`.trim();
    }
    case "bash":
      return `$ ${asString(record.command)}`.trim();
    default: {
      let json = "";
      try {
        json = JSON.stringify(record);
      } catch {
        // arguments not serializable; fall back to the bare tool name
      }
      return json && json !== "{}" ? `${toolName} ${json}` : toolName;
    }
  }
}

export interface FusionPrompts {
  discovery: string;
  rewrite: string;
  worker: string;
  synthesis: string;
}

export const DEFAULT_PROMPTS: FusionPrompts = {
  discovery: `You are the discovery agent in an LLM Fusion pipeline.

Your only job is to load context for the rest of the team. Spend tool calls to surface the files, symbols, APIs, commands, and snippets that look relevant to the request, so downstream workers and the synthesizer can work from shared context instead of repeating your exploration.

This is a mechanical gathering step, not an analysis step. Do not answer the user's request, solve the problem, plan an implementation, assess or rank relevance, judge quality, or make any recommendation. Do not offer opinions or conclusions of any kind — they would bias the workers. When you have gathered the context, stop.

{{toolGuidance}}

Working directory: {{cwd}}

{{recentContext}}## User request to gather context for

{{task}}

## Output contract

Return a context handoff in markdown with:

1. **Context loaded** — the files, symbols, APIs, commands, snippets, and search results you inspected, with concrete paths/line ranges and a neutral one-line note of what each contains (not why it matters or whether it is useful).
2. **Gaps** — relevant context you could not load, if any.

State facts only. Include enough detail that workers and the synthesis step can avoid re-reading the same files. Then stop.`,

  rewrite: `Rewrite the user's request into {{workerCount}} complementary exploration prompts for parallel planning workers.

This is query rewriting, similar to RAG query expansion. The rewrites should explore the idea space from different useful angles without assigning named personas. Keep them specific and grounded in the original request and the recent context.

## User request

{{task}}

{{recentContext}}## Output contract

Return only a JSON array of {{workerCount}} strings. No markdown, no explanation.`,

  worker: `{{discoveryContext}}You are worker {{workerName}} in an LLM Fusion planning pass.

Your job is to think and investigate before the synthesis step runs. {{toolGuidance}} {{discoveryGuidance}}

Working directory: {{cwd}}

{{recentContext}}## Original user request

{{task}}

## Assigned rewritten exploration prompt

{{assignedPrompt}}

## Output contract

Return concise markdown with these sections:

1. **Understanding** — what this exploration prompt means for the original request.
2. **Additional context** — only new files, symbols, patterns, or commands beyond discovery.
3. **Plan** — concrete steps for the synthesis step.
4. **Risks and verification** — edge cases, tests, or manual checks.

Keep the result useful for the downstream synthesis step. Do not implement anything.`,

  synthesis: `<!-- pi-fusion:synthesis-prompt -->
{{discoveryContext}}# LLM Fusion planning bundle

A discovery agent gathered the shared context above, a query-rewrite pass generated worker prompts, and workers independently explored/planned. Synthesize their advice, verify anything important yourself, then act on the original request using your available tools. Treat all subagent output as advisory, not authoritative.{{imageNote}}

## Original user request

{{task}}{{variations}}

## Worker outputs

{{workerOutputs}}

## Synthesis instructions

- Act on the original request, not on the workers' wording.
- Use shared discovery context before re-reading files; avoid redundant tool calls unless verification or missing context requires them.
- Use the workers to reduce blind spots, but verify before editing or running risky commands.
- Keep your visible response natural; do not dump a long meta-synthesis unless the user asked for one.
- If worker plans disagree, choose the smallest safe path and mention the tradeoff only if useful.`,
};

export function renderTemplate(template: string, variables: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = key.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, "g");
    result = result.replace(regex, String(value));
  }
  return result;
}

function plannerToolGuidance(mode: FusionPlannerToolMode, role: "discovery" | "worker"): string {
  if (mode === "read-only") {
    return role === "discovery"
      ? "Tool access: read-only tools only. Do not modify files, run write-capable commands, or ask for approval to make changes."
      : "Tool access: read-only tools only. Do not modify files, do not propose tool calls that write files, and do not ask the user to approve changes.";
  }

  return "Tool access: all available tools. Use them when they help investigation, but keep the result useful for the downstream synthesis step and avoid unnecessary changes.";
}

export function buildDiscoveryPrompt(input: {
  task: string;
  recentContext: string;
  cwd: string;
  plannerToolMode?: FusionPlannerToolMode;
  template?: string;
}): string {
  const templateStr = input.template ?? DEFAULT_PROMPTS.discovery;
  const contextSection = input.recentContext.trim() ? `## Recent conversation context (truncated)\n\n${input.recentContext.trim()}\n\n` : "";

  return renderTemplate(templateStr, {
    cwd: input.cwd,
    recentContext: contextSection,
    task: input.task.trim(),
    toolGuidance: plannerToolGuidance(input.plannerToolMode ?? DEFAULT_SETTINGS.plannerToolMode, "discovery"),
  });
}

export function buildRewritePrompt(input: { task: string; recentContext: string; workerCount: number; template?: string }): string {
  const templateStr = input.template ?? DEFAULT_PROMPTS.rewrite;
  const contextSection = input.recentContext.trim()
    ? `## Recent conversation context (truncated)\n\n${truncateUtf8(input.recentContext.trim(), 8_000)}\n\n`
    : "";

  return renderTemplate(templateStr, {
    workerCount: input.workerCount,
    task: input.task.trim(),
    recentContext: contextSection,
  });
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
  plannerToolMode?: FusionPlannerToolMode;
  template?: string;
}): string {
  const templateStr = input.template ?? DEFAULT_PROMPTS.worker;
  const discoverySection = input.discoveryContext.trim() ? `## Shared discovery context\n\n${input.discoveryContext.trim()}\n\n` : "";
  const recentSection = input.recentContext.trim() ? `## Recent conversation context (truncated)\n\n${input.recentContext.trim()}\n\n` : "";
  const readOnly = (input.plannerToolMode ?? DEFAULT_SETTINGS.plannerToolMode) === "read-only";
  const discoveryGuidance = input.discoveryContext.trim()
    ? readOnly
      ? "The shared discovery context above is loaded for you; use it before making tool calls. Only read/search more when it adds missing information, verifies uncertainty, or inspects files not already present."
      : "The shared discovery context above is loaded for you; use it before making tool calls. Only use more tools when it adds missing information, verifies uncertainty, or inspects context not already present."
    : readOnly
      ? "Investigate with read/search tools as needed before planning."
      : "Investigate with available tools as needed before planning.";

  return renderTemplate(templateStr, {
    discoveryContext: discoverySection,
    workerName: input.lens.name,
    discoveryGuidance,
    toolGuidance: plannerToolGuidance(input.plannerToolMode ?? DEFAULT_SETTINGS.plannerToolMode, "worker"),
    cwd: input.cwd,
    recentContext: recentSection,
    task: input.task.trim(),
    assignedPrompt: input.assignedPrompt.trim(),
  });
}

export function formatWorkerForSynthesis(result: WorkerResult, maxBytes: number): string {
  const status = result.ok ? "completed" : result.timedOut ? "timed out" : `failed${result.exitCode === null ? "" : ` (${result.exitCode})`}`;
  const diagnostics = result.stderr.trim() && !result.ok ? `\n\nStderr:\n${truncateUtf8(result.stderr.trim(), 2_000)}` : "";
  const usage = result.usage.turns
    ? `\n\nUsage: ${result.usage.turns} turn(s), ↑${result.usage.input}, ↓${result.usage.output}, $${result.usage.cost.toFixed(4)}${result.model ? `, ${result.model}` : ""}`
    : result.model
      ? `\n\nModel: ${result.model}`
      : "";

  return `## Worker ${result.index + 1}: ${result.lens} — ${status}\n\n${truncateUtf8(result.output.trim() || "(no output)", maxBytes)}${diagnostics}${usage}`;
}

export function buildSynthesisPrompt(input: {
  originalText: string;
  discoveryContext: string;
  promptVariations: string[];
  workerResults: WorkerResult[];
  workerOutputBytes: number;
  imageCount: number;
  template?: string;
}): string {
  const templateStr = input.template ?? DEFAULT_PROMPTS.synthesis;
  const workers = input.workerResults.map((result) => formatWorkerForSynthesis(result, input.workerOutputBytes)).join("\n\n---\n\n");
  const imageNote =
    input.imageCount > 0 ? `\n\nNote: the user attached ${input.imageCount} image(s). Workers did not see images; inspect them yourself.` : "";
  const discovery = input.discoveryContext.trim() ? `## Shared discovery context\n\n${truncateUtf8(input.discoveryContext.trim(), 64_000)}\n\n` : "";
  const variations =
    input.promptVariations.length > 0
      ? `\n\n## Worker prompt variations\n\n${input.promptVariations.map((variation, index) => `${index + 1}. ${variation}`).join("\n")}`
      : "";

  const prompt = renderTemplate(templateStr, {
    discoveryContext: discovery,
    imageNote,
    task: input.originalText.trim(),
    variations,
    workerOutputs: workers || "(no worker output)",
  });
  return prompt.includes(SYNTHESIS_PROMPT_MARKER) ? prompt : `${SYNTHESIS_PROMPT_MARKER}\n${prompt}`;
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
    if (!text || text.includes(SYNTHESIS_PROMPT_MARKER) || text.includes(LEGACY_SYNTHESIS_PROMPT_MARKER)) continue;

    chunks.unshift(`### ${role}\n\n${text}`);
    const joined = chunks.join("\n\n");
    if (Buffer.byteLength(joined, "utf8") > maxBytes) {
      return truncateUtf8(joined, maxBytes);
    }
  }

  return chunks.join("\n\n");
}
