import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  buildFusionArchiveEntries,
  buildSynthesisPrompt,
  buildDiscoveryPrompt,
  buildFusionTraceMessage,
  buildRewritePrompt,
  buildWorkerPrompt,
  collectRecentConversation,
  consumeNextTurnFusion,
  createFusionRunId,
  DEFAULT_SETTINGS,
  formatFusionTraceDetails,
  formatToolEvent,
  fusionTraceHeadline,
  FUSION_ARCHIVE_ENTRY_TYPE,
  FUSION_TRACE_MESSAGE_TYPE,
  listFusionArchiveRuns,
  reconstructFusionArchive,
  fusionStatusGlyph,
  getWorkerLens,
  normalizePlannerToolMode,
  normalizeWorkerSlots,
  parsePromptVariations,
  resolveSettings,
  resolveWorkerModel,
  resolveWorkerThinking,
  shouldBypassFusion,
  truncateUtf8,
  type FusionFlags,
  type FusionSettings,
  type PersistedFusionSettings,
  type WorkerResult,
} from "./fusion.ts";
import {
  applyFusionPresetSettings,
  findFusionPreset,
  loadFusionPresets,
  saveFusionPreset,
  loadFusionPrompts,
  initializeFusionPrompts,
} from "./presets.ts";
import { showFusionPane, startFusionLivePanel, type FusionLivePanelController, type FusionLiveWorkerState } from "./ui.ts";

interface JsonMessage {
  role?: string;
  content?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
  };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  toolName?: string;
}

interface RunWorkerInput {
  prompt: string;
  cwd: string;
  index: number;
  lens: string;
  timeoutMs: number;
  model: string | undefined;
  thinkingLevel: string | undefined;
  tools?: string[] | "none" | "all";
  signal?: AbortSignal;
  onLiveUpdate?: (index: number, patch: Partial<Omit<FusionLiveWorkerState, "index">>) => void;
}

interface FusionRunResult {
  synthesisPrompt: string;
  traceMessage: ReturnType<typeof buildFusionTraceMessage>;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };

  return { command: "pi", args };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function currentModelSpec(ctx: ExtensionContext): string | undefined {
  if (!ctx.model) return undefined;
  return `${ctx.model.provider}/${ctx.model.id}`;
}

function plannerToolsForMode(settings: FusionSettings): string[] | "all" {
  return settings.plannerToolMode === "all" ? "all" : ["read", "grep", "find", "ls"];
}

async function writePromptFile(index: number, prompt: string): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-fusion-"));
  const file = path.join(dir, `worker-${index + 1}.md`);
  await fs.writeFile(file, prompt, { encoding: "utf8", mode: 0o600 });
  return { dir, file };
}

async function cleanupPromptFile(tmp: { dir: string; file: string }): Promise<void> {
  await fs.rm(tmp.file, { force: true }).catch(() => undefined);
  await fs.rmdir(tmp.dir).catch(() => undefined);
}

async function runWorker(input: RunWorkerInput): Promise<WorkerResult> {
  const tmp = await writePromptFile(input.index, input.prompt);
  const result: WorkerResult = {
    index: input.index,
    lens: input.lens,
    ok: false,
    output: "",
    reasoning: "",
    toolContext: "",
    stderr: "",
    exitCode: null,
    timedOut: false,
    model: input.model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
  };

  try {
    const args = ["--mode", "json", "-p", "--no-session", "--no-extensions"];
    if (input.tools === "none") args.push("--no-tools");
    else if (input.tools !== "all") args.push("--tools", (input.tools ?? ["read", "grep", "find", "ls"]).join(","));
    if (input.model) args.push("--model", input.model);
    if (input.thinkingLevel) args.push("--thinking", input.thinkingLevel);
    args.push(`@${tmp.file}`);

    const invocation = getPiInvocation(args);
    const exitCode = await new Promise<number | null>((resolve) => {
      const liveEvents: string[] = [];
      const proc = spawn(invocation.command, invocation.args, {
        cwd: input.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const onAbort = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5_000).unref();
      };
      if (input.signal) {
        if (input.signal.aborted) onAbort();
        else input.signal.addEventListener("abort", onAbort, { once: true });
      }

      let stdoutBuffer = "";
      let timeout: NodeJS.Timeout | undefined;

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === "message_update" && event.assistantMessageEvent) {
          const update = event.assistantMessageEvent as { type?: string; delta?: string };
          if (update.type === "text_delta" && update.delta) {
            result.output += update.delta;
            input.onLiveUpdate?.(input.index, { output: result.output });
          } else if (update.type === "thinking_delta" && update.delta) {
            result.reasoning += update.delta;
            input.onLiveUpdate?.(input.index, { reasoning: result.reasoning });
          }
          return;
        }

        if (event.type === "tool_execution_start" && event.toolName) {
          const label = formatToolEvent(event.toolName, event.args, os.homedir());
          liveEvents.push(label.length > 100 ? `${label.slice(0, 99)}…` : label);
          input.onLiveUpdate?.(input.index, { events: [...liveEvents] });
          return;
        }

        const toolResultMessage = event.message as JsonMessage | undefined;
        if ((event.type === "tool_result_end" || (event.type === "message_end" && toolResultMessage?.role === "toolResult")) && toolResultMessage) {
          const toolText = textFromContent(toolResultMessage.content).trim();
          if (toolText) {
            const toolName = toolResultMessage.toolName ?? event.toolName ?? "tool";
            result.toolContext = truncateUtf8(`${result.toolContext}\n\n### ${toolName}\n\n${toolText}`.trim(), 48_000);
          }
          return;
        }

        if (event.type !== "message_end" || !event.message) return;
        const message = event.message as JsonMessage;
        if (message.role !== "assistant") return;

        const text = textFromContent(message.content).trim();
        if (text) {
          result.output = text;
          input.onLiveUpdate?.(input.index, { output: result.output });
        }
        result.usage.turns += 1;
        result.usage.input += message.usage?.input ?? 0;
        result.usage.output += message.usage?.output ?? 0;
        result.usage.cacheRead += message.usage?.cacheRead ?? 0;
        result.usage.cacheWrite += message.usage?.cacheWrite ?? 0;
        result.usage.cost += message.usage?.cost?.total ?? 0;
        result.model = result.model ?? message.model;
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          result.output = message.errorMessage || result.output;
          input.onLiveUpdate?.(input.index, { output: result.output });
        }
      };

      proc.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        result.stderr += data.toString();
      });

      proc.on("error", (error) => {
        result.stderr += error.message;
        resolve(null);
      });

      proc.on("close", (code) => {
        if (timeout) clearTimeout(timeout);
        input.signal?.removeEventListener("abort", onAbort);
        if (stdoutBuffer.trim()) processLine(stdoutBuffer);
        resolve(code ?? 0);
      });

      timeout = setTimeout(() => {
        result.timedOut = true;
        input.onLiveUpdate?.(input.index, { status: "timed-out" });
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5_000).unref();
      }, input.timeoutMs);
      timeout.unref();
    });

    result.exitCode = exitCode;
    result.ok = exitCode === 0 && !result.timedOut && result.output.trim().length > 0;
    if (!result.output.trim()) result.output = result.stderr.trim() || "(worker produced no final assistant output)";
    input.onLiveUpdate?.(input.index, {
      status: result.ok ? "done" : result.timedOut ? "timed-out" : "failed",
      output: result.output,
      reasoning: result.reasoning,
    });
    return result;
  } finally {
    await cleanupPromptFile(tmp);
  }
}

function readPersistedSettings(ctx: ExtensionContext): PersistedFusionSettings | undefined {
  const entries = ctx.sessionManager.getBranch() as Array<{ type?: string; customType?: string; data?: unknown }>;
  const latest = entries.filter((entry) => entry.type === "custom" && entry.customType === "pi-fusion-settings").pop();
  if (!latest || !latest.data || typeof latest.data !== "object") return undefined;
  return latest.data as PersistedFusionSettings;
}

function settingsFromFlags(pi: ExtensionAPI, persisted?: PersistedFusionSettings): FusionSettings {
  const flags: FusionFlags = {
    "fusion-enabled": pi.getFlag("fusion-enabled"),
    "fusion-disabled": pi.getFlag("fusion-disabled"),
    "fusion-no-discovery": pi.getFlag("fusion-no-discovery"),
    "fusion-no-rewrite": pi.getFlag("fusion-no-rewrite"),
    "fusion-workers": pi.getFlag("fusion-workers"),
    "fusion-output-bytes": pi.getFlag("fusion-output-bytes"),
    "fusion-context-bytes": pi.getFlag("fusion-context-bytes"),
    "fusion-resume-bytes": pi.getFlag("fusion-resume-bytes"),
    "fusion-timeout-ms": pi.getFlag("fusion-timeout-ms"),
    "fusion-model": pi.getFlag("fusion-model"),
    "fusion-discovery-model": pi.getFlag("fusion-discovery-model"),
    "fusion-worker-model": pi.getFlag("fusion-worker-model"),
    "fusion-synthesis-model": pi.getFlag("fusion-synthesis-model"),
    "fusion-discovery-thinking": pi.getFlag("fusion-discovery-thinking"),
    "fusion-worker-thinking": pi.getFlag("fusion-worker-thinking"),
    "fusion-synthesis-thinking": pi.getFlag("fusion-synthesis-thinking"),
    "fusion-planner-tools": pi.getFlag("fusion-planner-tools"),
    "fusion-preset": pi.getFlag("fusion-preset"),
  };
  return resolveSettings(flags, persisted);
}

function settingsSummary(settings: FusionSettings): string {
  return [
    `armed=${settings.enabled}`,
    `discovery=${settings.discoveryEnabled}`,
    `rewrite=${settings.rewriteEnabled}`,
    `workers=${settings.workerCount}`,
    `workerOutputBytes=${settings.workerOutputBytes}`,
    `contextBytes=${settings.contextBytes}`,
    `resumeContextBytes=${settings.resumeContextBytes}`,
    `timeoutMs=${settings.timeoutMs}`,
    `discoveryModel=${settings.discoveryModel ?? "current"}`,
    `discoveryThinking=${settings.discoveryThinking ?? "current"}`,
    `workerModel=${settings.workerModel ?? "current"}`,
    `workerThinking=${settings.workerThinking ?? "current"}`,
    `synthesisModel=${settings.synthesisModel ?? "current"}`,
    `synthesisThinking=${settings.synthesisThinking ?? "current"}`,
    `plannerTools=${settings.plannerToolMode}`,
    `preset=${settings.preset ?? "none"}`,
  ].join(" ");
}

function findModelBySpec(ctx: ExtensionContext, spec: string): ReturnType<ExtensionContext["modelRegistry"]["getAll"]>[number] | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1));
}

function buildSharedDiscoveryContext(result: WorkerResult): string {
  return truncateUtf8(
    [
      result.toolContext.trim() ? `## Discovery tool context\n\n${result.toolContext.trim()}` : "",
      `## Discovery context handoff\n\n${result.output.trim() || "(no discovery context handoff)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    64_000,
  );
}

export default function piFusion(pi: ExtensionAPI): void {
  let settings: FusionSettings = { ...DEFAULT_SETTINGS };
  let armedForNextTurn = false;
  let lastTranscriptRuns: ReturnType<typeof listFusionArchiveRuns> = [];

  pi.registerMessageRenderer(FUSION_TRACE_MESSAGE_TYPE, (message, { expanded }, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const body = expanded
      ? formatFusionTraceDetails(message.details)
      : `${fusionTraceHeadline(content)}\n\n${theme.fg("dim", "Expand for previews; /fusion-transcript for the full archive.")}`;
    return new Text(body, 1, 1, (text) => theme.bg("customMessageBg", text));
  });

  pi.registerFlag("fusion-enabled", {
    description: "Enable pi-fusion on startup (off by default; fusion multiplies token usage)",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("fusion-disabled", {
    description: "Force pi-fusion off on startup, overriding --fusion-enabled",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("fusion-no-discovery", {
    description: "Skip the discovery stage (on by default)",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("fusion-no-rewrite", {
    description: "Skip the prompt-rewrite stage; workers explore the original task (on by default)",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("fusion-workers", {
    description: "Number of parallel pi-fusion workers (1-8, default 3)",
    type: "string",
    default: String(DEFAULT_SETTINGS.workerCount),
  });
  pi.registerFlag("fusion-output-bytes", {
    description: "Max bytes from each worker inserted into the synthesis prompt",
    type: "string",
    default: String(DEFAULT_SETTINGS.workerOutputBytes),
  });
  pi.registerFlag("fusion-context-bytes", {
    description: "Max bytes of recent conversation sent to each worker",
    type: "string",
    default: String(DEFAULT_SETTINGS.contextBytes),
  });
  pi.registerFlag("fusion-resume-bytes", {
    description: "Max bytes of worker conclusions kept in context for resumed/subsequent turns",
    type: "string",
    default: String(DEFAULT_SETTINGS.resumeContextBytes),
  });
  pi.registerFlag("fusion-timeout-ms", {
    description: "Planner worker timeout in milliseconds",
    type: "string",
    default: String(DEFAULT_SETTINGS.timeoutMs),
  });
  pi.registerFlag("fusion-model", {
    description: "Alias for --fusion-worker-model",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-discovery-model", {
    description: "Model for the fusion discovery agent, or current/default",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-worker-model", {
    description: "Model for fusion workers, or current/default",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-synthesis-model", {
    description: "Model for the synthesis turn, or current/default",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-discovery-thinking", {
    description: "Reasoning effort for discovery: current/off/minimal/low/medium/high/xhigh",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-worker-thinking", {
    description: "Reasoning effort for fusion workers: current/off/minimal/low/medium/high/xhigh",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-synthesis-thinking", {
    description: "Reasoning effort for the synthesis turn: current/off/minimal/low/medium/high/xhigh",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-planner-tools", {
    description: "Tool access for discovery and planner workers: all/read-only (default all)",
    type: "string",
    default: DEFAULT_SETTINGS.plannerToolMode,
  });
  pi.registerFlag("fusion-preset", {
    description: "Load a named pi-fusion preset from ~/.pi/agent/fusion.json or .pi/fusion.json",
    type: "string",
    default: "",
  });

  function persist(): void {
    pi.appendEntry("pi-fusion-settings", settings);
  }

  function setFusionStatus(ctx: ExtensionContext, lines: string[] | undefined): void {
    if (!ctx.hasUI) return;
    if (!lines) {
      ctx.ui.setStatus("pi-fusion", fusionStatusGlyph(settings.enabled));
      ctx.ui.setWidget("pi-fusion", undefined);
      return;
    }
    ctx.ui.setStatus("pi-fusion", fusionStatusGlyph(settings.enabled));
    ctx.ui.setWidget("pi-fusion", lines);
  }

  function clearFusionStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("pi-fusion", undefined);
    ctx.ui.setWidget("pi-fusion", undefined);
  }

  async function loadPresetByName(ctx: ExtensionContext, name: string): Promise<boolean> {
    const presets = await loadFusionPresets(ctx.cwd);
    const preset = findFusionPreset(presets, name);
    if (!preset) {
      const available = presets.map((item) => item.name).join(", ") || "(none saved)";
      ctx.ui.notify(`Unknown fusion preset "${name}". Available: ${available}`, "error");
      return false;
    }
    settings = applyFusionPresetSettings(settings, preset.name, preset);
    ctx.ui.notify(`Loaded fusion preset "${preset.name}"`, "info");
    return true;
  }

  async function handlePresetCommand(value: string, ctx: ExtensionContext): Promise<boolean> {
    const [subcommand, ...rest] = value.trim().split(/\s+/).filter(Boolean);
    const name = rest.join(" ").trim();

    if (!subcommand || subcommand === "list") {
      const presets = await loadFusionPresets(ctx.cwd);
      if (presets.length === 0) {
        ctx.ui.notify("No fusion presets saved yet. Open /fusion → Presets → Save current settings.", "info");
      } else {
        ctx.ui.notify(`Fusion presets: ${presets.map((preset) => `${preset.name} (${preset.scope})`).join(", ")}`, "info");
      }
      return true;
    }

    if (subcommand === "save" || subcommand === "save-global" || subcommand === "save-project") {
      if (!name) {
        ctx.ui.notify("Usage: /fusion preset save NAME", "error");
        return false;
      }
      const scope = subcommand === "save-project" ? "project" : "global";
      const savedPath = await saveFusionPreset(ctx.cwd, name, settings, scope);
      settings.preset = name;
      ctx.ui.notify(`Saved fusion preset "${name}" to ${savedPath}`, "info");
      return true;
    }

    return loadPresetByName(ctx, [subcommand, ...rest].join(" "));
  }

  pi.registerCommand("fusion", {
    description: "Open/configure LLM Fusion (UI, models, workers)",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const command = parts[0];
      const value = parts.slice(1).join(" ");

      if (!command || command === "ui") {
        const updated = await showFusionPane(ctx, settings, (enabled) => {
          settings.enabled = enabled;
          persist();
          setFusionStatus(ctx, undefined);
        });
        if (updated) {
          settings = updated;
          persist();
          setFusionStatus(ctx, undefined);
        }
        ctx.ui.notify(`pi-fusion ${settingsSummary(settings)}`, "info");
        return;
      }

      if (command === "status") {
        ctx.ui.notify(`pi-fusion ${settingsSummary(settings)}`, "info");
        return;
      }

      if (command === "on") settings.enabled = true;
      else if (command === "off") settings.enabled = false;
      else if (command === "discovery") settings.discoveryEnabled = value.toLowerCase() !== "off";
      else if (command === "rewrite") settings.rewriteEnabled = value.toLowerCase() !== "off";
      else if (command === "tools" || command === "planner-tools")
        settings.plannerToolMode = normalizePlannerToolMode(value, settings.plannerToolMode);
      else if (command === "workers") {
        settings.workerCount = resolveSettings({ "fusion-workers": value }, settings).workerCount;
        settings.workers = normalizeWorkerSlots(settings.workers, settings.workerCount);
      } else if (command === "output") settings.workerOutputBytes = resolveSettings({ "fusion-output-bytes": value }, settings).workerOutputBytes;
      else if (command === "context") settings.contextBytes = resolveSettings({ "fusion-context-bytes": value }, settings).contextBytes;
      else if (command === "resume" || command === "resume-bytes")
        settings.resumeContextBytes = resolveSettings({ "fusion-resume-bytes": value }, settings).resumeContextBytes;
      else if (command === "timeout") settings.timeoutMs = resolveSettings({ "fusion-timeout-ms": value }, settings).timeoutMs;
      else if (command === "discovery-model") settings.discoveryModel = resolveSettings({ "fusion-discovery-model": value }, settings).discoveryModel;
      else if (command === "discovery-thinking" || command === "discovery-reasoning") {
        settings.discoveryThinking = resolveSettings({ "fusion-discovery-thinking": value }, settings).discoveryThinking;
      } else if (command === "model" || command === "worker-model")
        settings.workerModel = resolveSettings({ "fusion-worker-model": value }, settings).workerModel;
      else if (command === "worker-thinking" || command === "worker-reasoning") {
        settings.workerThinking = resolveSettings({ "fusion-worker-thinking": value }, settings).workerThinking;
      } else if (command === "synthesis-model") {
        settings.synthesisModel = resolveSettings({ "fusion-synthesis-model": value }, settings).synthesisModel;
      } else if (command === "synthesis-thinking" || command === "synthesis-reasoning") {
        settings.synthesisThinking = resolveSettings({ "fusion-synthesis-thinking": value }, settings).synthesisThinking;
      } else if (command === "preset") {
        const ok = await handlePresetCommand(value, ctx);
        if (!ok) return;
      } else {
        ctx.ui.notify(
          "Usage: /fusion [ui|status|on|off|preset [list|save NAME|save-project NAME|NAME]|discovery on|off|rewrite on|off|tools all|read-only|workers N|discovery-model SPEC|discovery-thinking LEVEL|worker-model SPEC|worker-thinking LEVEL|synthesis-model SPEC|synthesis-thinking LEVEL|output BYTES|context BYTES|resume BYTES|timeout MS]",
          "info",
        );
        return;
      }

      persist();
      setFusionStatus(ctx, undefined);
      ctx.ui.notify(`pi-fusion ${settingsSummary(settings)}`, "info");
    },
  });

  pi.registerCommand("fusion-transcript", {
    description: "Show or export the full archived sub-agent transcript for a fusion run",
    getArgumentCompletions: (prefix) => {
      const items = lastTranscriptRuns.map((run) => ({
        value: run.runId,
        label: run.runId,
        description: `${run.completedWorkers}/${run.workerCount} workers • ${run.bytes} bytes`,
      }));
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      lastTranscriptRuns = listFusionArchiveRuns(entries);

      const parts = args.trim().split(/\s+/).filter(Boolean);
      let writePath: string | undefined;
      const writeIndex = parts.indexOf("--write");
      if (writeIndex !== -1) {
        writePath = parts[writeIndex + 1];
        parts.splice(writeIndex, writePath ? 2 : 1);
      }
      const runId = parts[0];

      if (parts[0] === "list" || (!runId && lastTranscriptRuns.length > 1 && !writePath)) {
        if (lastTranscriptRuns.length === 0) {
          ctx.ui.notify("No pi-fusion runs archived in this session yet.", "info");
          return;
        }
        const summary = lastTranscriptRuns
          .map((run) => `${run.runId} (${run.completedWorkers}/${run.workerCount} workers, ${run.bytes} bytes)`)
          .join("\n");
        ctx.ui.notify(`pi-fusion runs in this session:\n${summary}`, "info");
        return;
      }

      const archive = reconstructFusionArchive(entries, runId === "list" ? undefined : runId);
      if (!archive) {
        ctx.ui.notify(runId ? `No archived pi-fusion run found for "${runId}".` : "No pi-fusion runs archived in this session yet.", "warning");
        return;
      }

      if (writePath) {
        const resolved = path.resolve(ctx.cwd, writePath);
        await fs.writeFile(resolved, archive.content, "utf8");
        ctx.ui.notify(`Wrote pi-fusion transcript (${archive.manifest.bytes} bytes) to ${resolved}`, "info");
        return;
      }

      if (ctx.hasUI) {
        await ctx.ui.editor(`pi-fusion transcript: ${archive.manifest.runId}`, archive.content);
        return;
      }

      const tmpFile = path.join(os.tmpdir(), `${archive.manifest.runId}.md`);
      await fs.writeFile(tmpFile, archive.content, "utf8");
      ctx.ui.notify(`Wrote pi-fusion transcript to ${tmpFile}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await initializeFusionPrompts(ctx.cwd);
    settings = settingsFromFlags(pi, readPersistedSettings(ctx));
    const presetFlag = pi.getFlag("fusion-preset");
    if (typeof presetFlag === "string" && presetFlag.trim()) {
      await loadPresetByName(ctx, presetFlag.trim());
    }
    setFusionStatus(ctx, undefined);
  });

  pi.on("session_compact", async (_event, ctx) => {
    persist();
    setFusionStatus(ctx, undefined);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearFusionStatus(ctx);
  });

  async function runFusion(ctx: ExtensionContext, task: string, imageCount: number): Promise<FusionRunResult | undefined> {
    const prompts = await loadFusionPrompts(ctx.cwd);
    const recentContext = collectRecentConversation(ctx.sessionManager.getBranch() as unknown[], settings.contextBytes);
    const currentModel = currentModelSpec(ctx);
    const workerModel = settings.workerModel ?? currentModel;
    const discoveryModel = settings.discoveryModel ?? currentModel;
    const discoveryThinking = settings.discoveryThinking ?? pi.getThinkingLevel();
    const abort = new AbortController();
    const cancelFusion = () => abort.abort();
    if (ctx.signal) {
      if (ctx.signal.aborted) abort.abort();
      else ctx.signal.addEventListener("abort", cancelFusion, { once: true });
    }
    let activePanel: FusionLivePanelController | undefined;
    let discoveryResult: WorkerResult | undefined;
    let rewriteResult: WorkerResult | undefined;

    try {
      const rewritePromise = settings.rewriteEnabled
        ? runWorker({
            prompt: buildRewritePrompt({
              task,
              recentContext,
              workerCount: settings.workerCount,
              template: prompts.rewrite,
            }),
            cwd: ctx.cwd,
            index: 0,
            lens: "rewrite",
            timeoutMs: Math.min(settings.timeoutMs, 120_000),
            model: workerModel,
            thinkingLevel: "minimal",
            tools: "none",
            signal: abort.signal,
          })
        : undefined;

      let discoveryContext = "";
      if (settings.discoveryEnabled) {
        activePanel = startFusionLivePanel(
          ctx,
          [{ index: 0, label: "discovery", lens: "context loading", status: "queued", output: "", reasoning: "", events: [] }],
          "LLM Fusion discovery",
          cancelFusion,
        );
        setFusionStatus(ctx, undefined);
        activePanel?.update(0, { status: "running" });
        discoveryResult = await runWorker({
          prompt: buildDiscoveryPrompt({
            task,
            recentContext,
            cwd: ctx.cwd,
            plannerToolMode: settings.plannerToolMode,
            template: prompts.discovery,
          }),
          cwd: ctx.cwd,
          index: 0,
          lens: "discovery",
          timeoutMs: settings.timeoutMs,
          model: discoveryModel,
          thinkingLevel: discoveryThinking,
          tools: plannerToolsForMode(settings),
          signal: abort.signal,
          onLiveUpdate: (_index, patch) => activePanel?.update(0, patch),
        });
        if (abort.signal.aborted) return undefined;
        discoveryContext = buildSharedDiscoveryContext(discoveryResult);
        activePanel?.close();
        activePanel = undefined;
      }

      let promptVariations: string[];
      if (rewritePromise) {
        rewriteResult = await rewritePromise;
        if (abort.signal.aborted) return undefined;
        promptVariations = parsePromptVariations(rewriteResult.output, settings.workerCount, task);
      } else {
        promptVariations = Array.from({ length: settings.workerCount }, () => task);
      }
      const statusLines = promptVariations.map((_, index) => `○ worker ${index + 1}: ${getWorkerLens(index).name}`);
      setFusionStatus(ctx, statusLines);
      const workerStates: FusionLiveWorkerState[] = promptVariations.map((variation, index) => ({
        index,
        label: getWorkerLens(index).name,
        lens: "worker",
        prompt: variation,
        status: "queued" as const,
        output: "",
        reasoning: "",
        events: [],
      }));
      activePanel = startFusionLivePanel(ctx, workerStates, "LLM Fusion workers", cancelFusion);

      const workerPromises = promptVariations.map(async (variation, index) => {
        const lens = getWorkerLens(index);
        const prompt = buildWorkerPrompt({
          task,
          assignedPrompt: variation,
          recentContext,
          discoveryContext,
          cwd: ctx.cwd,
          lens,
          plannerToolMode: settings.plannerToolMode,
          template: prompts.worker,
        });
        activePanel?.update(index, { status: "running" });
        const result = await runWorker({
          prompt,
          cwd: ctx.cwd,
          index,
          lens: lens.name,
          timeoutMs: settings.timeoutMs,
          model: resolveWorkerModel(settings, index, currentModel),
          thinkingLevel: resolveWorkerThinking(settings, index, pi.getThinkingLevel()),
          tools: plannerToolsForMode(settings),
          signal: abort.signal,
          onLiveUpdate: (workerIndex, patch) => activePanel?.update(workerIndex, patch),
        });
        statusLines[index] = `${result.ok ? "●" : "⊘"} worker ${index + 1}: ${lens.name}`;
        setFusionStatus(ctx, statusLines);
        return result;
      });

      const workerResults = await Promise.all(workerPromises);
      if (abort.signal.aborted) return undefined;

      // Persist the full, untruncated sub-agent transcript as non-context
      // `custom` archive entries before synthesis. These stay in the session
      // file for audit/resume but are never fed back to the LLM.
      const runId = createFusionRunId();
      const archive = buildFusionArchiveEntries({
        runId,
        task,
        discoveryEnabled: settings.discoveryEnabled,
        rewriteEnabled: settings.rewriteEnabled,
        promptVariations: settings.rewriteEnabled ? promptVariations : [],
        discoveryResult,
        rewriteResult,
        workerResults,
      });
      pi.appendEntry(FUSION_ARCHIVE_ENTRY_TYPE, archive.manifest);
      for (const chunk of archive.chunks) pi.appendEntry(FUSION_ARCHIVE_ENTRY_TYPE, chunk);

      if (settings.synthesisModel) {
        const synthesisModel = findModelBySpec(ctx, settings.synthesisModel);
        if (!synthesisModel) {
          ctx.ui.notify(`pi-fusion: synthesis model not found: ${settings.synthesisModel}`, "warning");
        } else if (!(await pi.setModel(synthesisModel))) {
          ctx.ui.notify(`pi-fusion: no API key for synthesis model: ${settings.synthesisModel}`, "warning");
        }
      }
      if (settings.synthesisThinking) pi.setThinkingLevel(settings.synthesisThinking);

      return {
        synthesisPrompt: buildSynthesisPrompt({
          originalText: task,
          discoveryContext,
          promptVariations: settings.rewriteEnabled ? promptVariations : [],
          workerResults,
          workerOutputBytes: settings.workerOutputBytes,
          imageCount,
          template: prompts.synthesis,
        }),
        traceMessage: buildFusionTraceMessage({
          task,
          discoveryEnabled: settings.discoveryEnabled,
          rewriteEnabled: settings.rewriteEnabled,
          promptVariations: settings.rewriteEnabled ? promptVariations : [],
          discoveryResult,
          rewriteResult,
          workerResults,
          runId,
          archiveChunks: archive.chunks.length,
          archiveBytes: archive.manifest.bytes,
          resumeContextBytes: settings.resumeContextBytes,
        }),
      };
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`pi-fusion failed; continuing without fusion: ${message}`, "warning");
      }
      return undefined;
    } finally {
      ctx.signal?.removeEventListener("abort", cancelFusion);
      activePanel?.close();
      setFusionStatus(ctx, undefined);
    }
  }

  pi.on("input", async (event, ctx) => {
    const bypassReason = shouldBypassFusion({
      enabled: settings.enabled,
      text: event.text,
      source: event.source,
      streamingBehavior: event.streamingBehavior,
      isIdle: ctx.isIdle(),
    });
    armedForNextTurn = !bypassReason;
    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!armedForNextTurn) return;
    armedForNextTurn = false;
    consumeNextTurnFusion(settings);
    persist();
    setFusionStatus(ctx, undefined);
    const result = await runFusion(ctx, event.prompt, event.images?.length ?? 0);
    if (!result) return;
    return { message: result.traceMessage, systemPrompt: `${event.systemPrompt}\n\n${result.synthesisPrompt}` };
  });
}
