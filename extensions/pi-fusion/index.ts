import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildActorPrompt,
  buildWorkerPrompt,
  collectRecentConversation,
  DEFAULT_SETTINGS,
  getWorkerLens,
  resolveSettings,
  shouldBypassFusion,
  type FusionFlags,
  type FusionSettings,
  type PersistedFusionSettings,
  type WorkerResult,
} from "./fusion.ts";
import { showFusionPane } from "./ui.ts";

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
}

interface RunWorkerInput {
  prompt: string;
  cwd: string;
  index: number;
  lens: string;
  timeoutMs: number;
  model: string | undefined;
  thinkingLevel: string | undefined;
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
    stderr: "",
    exitCode: null,
    timedOut: false,
    model: input.model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
  };

  try {
    const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--tools", "read,grep,find,ls"];
    if (input.model) args.push("--model", input.model);
    if (input.thinkingLevel) args.push("--thinking", input.thinkingLevel);
    args.push(`@${tmp.file}`);

    const invocation = getPiInvocation(args);
    const exitCode = await new Promise<number | null>((resolve) => {
      const proc = spawn(invocation.command, invocation.args, {
        cwd: input.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

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

        if (event.type !== "message_end" || !event.message) return;
        const message = event.message as JsonMessage;
        if (message.role !== "assistant") return;

        const text = textFromContent(message.content).trim();
        if (text) result.output = text;
        result.usage.turns += 1;
        result.usage.input += message.usage?.input ?? 0;
        result.usage.output += message.usage?.output ?? 0;
        result.usage.cacheRead += message.usage?.cacheRead ?? 0;
        result.usage.cacheWrite += message.usage?.cacheWrite ?? 0;
        result.usage.cost += message.usage?.cost?.total ?? 0;
        result.model = result.model ?? message.model;
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          result.output = message.errorMessage || result.output;
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
        if (stdoutBuffer.trim()) processLine(stdoutBuffer);
        resolve(code ?? 0);
      });

      timeout = setTimeout(() => {
        result.timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5_000).unref();
      }, input.timeoutMs);
      timeout.unref();
    });

    result.exitCode = exitCode;
    result.ok = exitCode === 0 && !result.timedOut && result.output.trim().length > 0;
    if (!result.output.trim()) result.output = result.stderr.trim() || "(worker produced no final assistant output)";
    return result;
  } finally {
    await cleanupPromptFile(tmp);
  }
}

function readPersistedSettings(ctx: ExtensionContext): PersistedFusionSettings | undefined {
  const entries = ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>;
  const latest = entries.filter((entry) => entry.type === "custom" && entry.customType === "pi-fusion-settings").pop();
  if (!latest || !latest.data || typeof latest.data !== "object") return undefined;
  return latest.data as PersistedFusionSettings;
}

function settingsFromFlags(pi: ExtensionAPI, persisted?: PersistedFusionSettings): FusionSettings {
  const flags: FusionFlags = {
    "fusion-disabled": pi.getFlag("fusion-disabled"),
    "fusion-workers": pi.getFlag("fusion-workers"),
    "fusion-output-bytes": pi.getFlag("fusion-output-bytes"),
    "fusion-context-bytes": pi.getFlag("fusion-context-bytes"),
    "fusion-timeout-ms": pi.getFlag("fusion-timeout-ms"),
    "fusion-model": pi.getFlag("fusion-model"),
    "fusion-worker-model": pi.getFlag("fusion-worker-model"),
    "fusion-synthesizer-model": pi.getFlag("fusion-synthesizer-model"),
    "fusion-worker-thinking": pi.getFlag("fusion-worker-thinking"),
    "fusion-synthesizer-thinking": pi.getFlag("fusion-synthesizer-thinking"),
  };
  return resolveSettings(flags, persisted);
}

function settingsSummary(settings: FusionSettings): string {
  return [
    `enabled=${settings.enabled}`,
    `workers=${settings.workerCount}`,
    `workerOutputBytes=${settings.workerOutputBytes}`,
    `contextBytes=${settings.contextBytes}`,
    `timeoutMs=${settings.timeoutMs}`,
    `workerModel=${settings.workerModel ?? "current"}`,
    `workerThinking=${settings.workerThinking ?? "current"}`,
    `synthesizerModel=${settings.synthesizerModel ?? "current"}`,
    `synthesizerThinking=${settings.synthesizerThinking ?? "current"}`,
  ].join(" ");
}

function findModelBySpec(ctx: ExtensionContext, spec: string): ReturnType<ExtensionContext["modelRegistry"]["getAll"]>[number] | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1));
}

export default function piFusion(pi: ExtensionAPI): void {
  let settings: FusionSettings = { ...DEFAULT_SETTINGS };

  pi.registerFlag("fusion-disabled", {
    description: "Disable pi-fusion on startup",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("fusion-workers", {
    description: "Number of parallel pi-fusion workers (1-8, default 3)",
    type: "string",
    default: String(DEFAULT_SETTINGS.workerCount),
  });
  pi.registerFlag("fusion-output-bytes", {
    description: "Max bytes from each worker inserted into the actor prompt",
    type: "string",
    default: String(DEFAULT_SETTINGS.workerOutputBytes),
  });
  pi.registerFlag("fusion-context-bytes", {
    description: "Max bytes of recent conversation sent to each worker",
    type: "string",
    default: String(DEFAULT_SETTINGS.contextBytes),
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
  pi.registerFlag("fusion-worker-model", {
    description: "Model for fusion workers, or current/default",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-synthesizer-model", {
    description: "Model for the synthesizer/actor turn, or current/default",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-worker-thinking", {
    description: "Reasoning effort for fusion workers: current/off/minimal/low/medium/high/xhigh",
    type: "string",
    default: "current",
  });
  pi.registerFlag("fusion-synthesizer-thinking", {
    description: "Reasoning effort for the synthesizer/actor turn: current/off/minimal/low/medium/high/xhigh",
    type: "string",
    default: "current",
  });

  function persist(): void {
    pi.appendEntry("pi-fusion-settings", settings);
  }

  function setFusionStatus(ctx: ExtensionContext, lines: string[] | undefined): void {
    if (!ctx.hasUI) return;
    if (!lines) {
      ctx.ui.setStatus("pi-fusion", settings.enabled ? undefined : "fusion off");
      ctx.ui.setWidget("pi-fusion", undefined);
      return;
    }
    ctx.ui.setStatus("pi-fusion", `fusion ${lines.filter((line) => line.includes("✓") || line.includes("✗")).length}/${settings.workerCount}`);
    ctx.ui.setWidget("pi-fusion", lines);
  }

  pi.registerCommand("fusion", {
    description: "Open/configure LLM Fusion (UI, models, workers)",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const command = parts[0];
      const value = parts.slice(1).join(" ");

      if (!command || command === "ui") {
        const updated = await showFusionPane(ctx, settings);
        if (!updated) return;
        settings = updated;
        persist();
        ctx.ui.notify(`pi-fusion ${settingsSummary(settings)}`, "info");
        return;
      }

      if (command === "status") {
        ctx.ui.notify(`pi-fusion ${settingsSummary(settings)}`, "info");
        return;
      }

      if (command === "on") settings.enabled = true;
      else if (command === "off") settings.enabled = false;
      else if (command === "workers") settings.workerCount = resolveSettings({ "fusion-workers": value }, settings).workerCount;
      else if (command === "output") settings.workerOutputBytes = resolveSettings({ "fusion-output-bytes": value }, settings).workerOutputBytes;
      else if (command === "context") settings.contextBytes = resolveSettings({ "fusion-context-bytes": value }, settings).contextBytes;
      else if (command === "timeout") settings.timeoutMs = resolveSettings({ "fusion-timeout-ms": value }, settings).timeoutMs;
      else if (command === "model" || command === "worker-model") settings.workerModel = resolveSettings({ "fusion-worker-model": value }, settings).workerModel;
      else if (command === "worker-thinking" || command === "worker-reasoning") {
        settings.workerThinking = resolveSettings({ "fusion-worker-thinking": value }, settings).workerThinking;
      } else if (command === "synthesizer-model" || command === "synth-model" || command === "synthesis-model") {
        settings.synthesizerModel = resolveSettings({ "fusion-synthesizer-model": value }, settings).synthesizerModel;
      } else if (command === "synthesizer-thinking" || command === "synth-thinking" || command === "synthesizer-reasoning" || command === "synth-reasoning") {
        settings.synthesizerThinking = resolveSettings({ "fusion-synthesizer-thinking": value }, settings).synthesizerThinking;
      } else {
        ctx.ui.notify(
          "Usage: /fusion [ui|status|on|off|workers N|worker-model SPEC|worker-thinking LEVEL|synthesizer-model SPEC|synthesizer-thinking LEVEL|output BYTES|context BYTES|timeout MS]",
          "info",
        );
        return;
      }

      persist();
      ctx.ui.notify(`pi-fusion ${settingsSummary(settings)}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    settings = settingsFromFlags(pi, readPersistedSettings(ctx));
    if (!settings.enabled && ctx.hasUI) ctx.ui.setStatus("pi-fusion", "fusion off");
  });

  pi.on("input", async (event, ctx) => {
    const bypassReason = shouldBypassFusion({
      enabled: settings.enabled,
      text: event.text,
      source: event.source,
      streamingBehavior: event.streamingBehavior,
      isIdle: ctx.isIdle(),
    });
    if (bypassReason) return { action: "continue" as const };

    const recentContext = collectRecentConversation(ctx.sessionManager.getBranch() as unknown[], settings.contextBytes);
    const model = settings.workerModel ?? currentModelSpec(ctx);
    const thinkingLevel = settings.workerThinking ?? pi.getThinkingLevel();
    const statusLines = Array.from({ length: settings.workerCount }, (_, index) => {
      const lens = getWorkerLens(index);
      return `⏳ worker ${index + 1}: ${lens.name}`;
    });
    setFusionStatus(ctx, statusLines);

    try {
      const workerPromises = Array.from({ length: settings.workerCount }, async (_, index) => {
        const lens = getWorkerLens(index);
        const prompt = buildWorkerPrompt({
          task: event.text,
          recentContext,
          cwd: ctx.cwd,
          workerIndex: index,
          workerCount: settings.workerCount,
          lens,
        });
        const result = await runWorker({
          prompt,
          cwd: ctx.cwd,
          index,
          lens: lens.name,
          timeoutMs: settings.timeoutMs,
          model,
          thinkingLevel,
        });
        statusLines[index] = `${result.ok ? "✓" : "✗"} worker ${index + 1}: ${lens.name}`;
        setFusionStatus(ctx, statusLines);
        return result;
      });

      const workerResults = await Promise.all(workerPromises);
      if (settings.synthesizerModel) {
        const synthesizerModel = findModelBySpec(ctx, settings.synthesizerModel);
        if (!synthesizerModel) {
          ctx.ui.notify(`pi-fusion: synthesizer model not found: ${settings.synthesizerModel}`, "warning");
        } else if (!(await pi.setModel(synthesizerModel))) {
          ctx.ui.notify(`pi-fusion: no API key for synthesizer model: ${settings.synthesizerModel}`, "warning");
        }
      }
      if (settings.synthesizerThinking) pi.setThinkingLevel(settings.synthesizerThinking);

      const actorPrompt = buildActorPrompt({
        originalText: event.text,
        workerResults,
        workerOutputBytes: settings.workerOutputBytes,
        imageCount: event.images?.length ?? 0,
      });

      return { action: "transform" as const, text: actorPrompt, images: event.images };
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`pi-fusion failed; continuing without fusion: ${message}`, "warning");
      }
      return { action: "continue" as const };
    } finally {
      setFusionStatus(ctx, undefined);
    }
  });
}
