import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolveSettings, type FusionSettings, type PersistedFusionSettings, DEFAULT_PROMPTS, type FusionPrompts } from "./fusion.ts";

export type FusionPresetScope = "global" | "project";

export interface FusionPresetRecord {
  description?: string;
  settings: PersistedFusionSettings;
}

export interface LoadedFusionPreset extends FusionPresetRecord {
  name: string;
  scope: FusionPresetScope;
  path: string;
}

interface FusionPresetFile {
  version?: number;
  presets?: Record<string, FusionPresetRecord | PersistedFusionSettings>;
  prompts?: {
    discovery?: string;
    rewrite?: string;
    worker?: string;
    actor?: string;
  };
}

function findProjectConfigRoot(cwd: string): string {
  let current = path.resolve(cwd);

  while (true) {
    if (existsSync(path.join(current, ".pi", "fusion.json")) || existsSync(path.join(current, ".git"))) return current;

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

export function fusionPresetPath(cwd: string, scope: FusionPresetScope): string {
  return scope === "global" ? path.join(getAgentDir(), "fusion.json") : path.join(findProjectConfigRoot(cwd), ".pi", "fusion.json");
}

export function snapshotFusionSettings(settings: FusionSettings): PersistedFusionSettings {
  return {
    enabled: settings.enabled,
    discoveryEnabled: settings.discoveryEnabled,
    rewriteEnabled: settings.rewriteEnabled,
    workerCount: settings.workerCount,
    workers: settings.workers.map((worker) => ({ ...worker })),
    workerOutputBytes: settings.workerOutputBytes,
    contextBytes: settings.contextBytes,
    timeoutMs: settings.timeoutMs,
    discoveryModel: settings.discoveryModel,
    workerModel: settings.workerModel,
    synthesizerModel: settings.synthesizerModel,
    discoveryThinking: settings.discoveryThinking,
    workerThinking: settings.workerThinking,
    synthesizerThinking: settings.synthesizerThinking,
  };
}

export function applyFusionPresetSettings(current: FusionSettings, name: string, preset: FusionPresetRecord): FusionSettings {
  return resolveSettings({}, { ...current, ...preset.settings, preset: name });
}

function coercePresetRecord(value: unknown): FusionPresetRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { description?: unknown; settings?: unknown };
  const settings =
    record.settings && typeof record.settings === "object" ? (record.settings as PersistedFusionSettings) : (value as PersistedFusionSettings);
  return {
    description: typeof record.description === "string" ? record.description : undefined,
    settings,
  };
}

async function readPresetFile(filePath: string): Promise<FusionPresetFile> {
  if (!existsSync(filePath)) return { version: 1, presets: {} };
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as FusionPresetFile;
    return { version: parsed.version ?? 1, presets: parsed.presets ?? {}, prompts: parsed.prompts };
  } catch {
    return { version: 1, presets: {} };
  }
}

export async function loadFusionPresets(cwd: string): Promise<LoadedFusionPreset[]> {
  const merged = new Map<string, LoadedFusionPreset>();

  for (const scope of ["global", "project"] as const) {
    const filePath = fusionPresetPath(cwd, scope);
    const file = await readPresetFile(filePath);
    for (const [name, rawPreset] of Object.entries(file.presets ?? {})) {
      const preset = coercePresetRecord(rawPreset);
      if (!preset) continue;
      merged.set(name, { name, scope, path: filePath, ...preset });
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveFusionPreset(
  cwd: string,
  name: string,
  settings: FusionSettings,
  scope: FusionPresetScope = "global",
  description?: string,
): Promise<string> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Preset name cannot be empty");

  const filePath = fusionPresetPath(cwd, scope);
  const file = await readPresetFile(filePath);
  file.version = 1;
  file.presets = file.presets ?? {};
  file.presets[cleanName] = {
    description: description?.trim() || undefined,
    settings: snapshotFusionSettings(settings),
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return filePath;
}

export async function deleteFusionPreset(cwd: string, name: string, scope: FusionPresetScope): Promise<boolean> {
  const filePath = fusionPresetPath(cwd, scope);
  const file = await readPresetFile(filePath);
  if (!file.presets || !(name in file.presets)) return false;
  delete file.presets[name];
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return true;
}

export function findFusionPreset(presets: LoadedFusionPreset[], name: string): LoadedFusionPreset | undefined {
  return presets.find((preset) => preset.name === name);
}

export async function loadFusionPrompts(cwd: string): Promise<FusionPrompts> {
  const prompts = { ...DEFAULT_PROMPTS };

  for (const scope of ["global", "project"] as const) {
    const file = await readPresetFile(fusionPresetPath(cwd, scope));
    prompts.discovery = file.prompts?.discovery ?? prompts.discovery;
    prompts.rewrite = file.prompts?.rewrite ?? prompts.rewrite;
    prompts.worker = file.prompts?.worker ?? prompts.worker;
    prompts.actor = file.prompts?.actor ?? prompts.actor;
  }

  return prompts;
}

export async function initializeFusionPrompts(cwd: string): Promise<void> {
  const globalPath = fusionPresetPath(cwd, "global");
  try {
    let file: FusionPresetFile = { version: 1, presets: {} };
    if (existsSync(globalPath)) {
      file = await readPresetFile(globalPath);
    }

    if (!file.prompts) {
      file.prompts = { ...DEFAULT_PROMPTS };
      await fs.mkdir(path.dirname(globalPath), { recursive: true });
      await fs.writeFile(globalPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    }
  } catch {
    // Best-effort
  }
}
