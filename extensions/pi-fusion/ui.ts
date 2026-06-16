import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  matchesKey,
  type SelectItem,
  SelectList,
  Text,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { normalizeWorkerSlots, THINKING_CHOICES, type FusionSettings, type FusionThinkingChoice, type FusionThinkingLevel } from "./fusion.ts";
import { applyFusionPresetSettings, deleteFusionPreset, loadFusionPresets, saveFusionPreset, type LoadedFusionPreset } from "./presets.ts";

interface FusionPaneResult {
  action: "save" | "cancel" | "pick-discovery-model" | "pick-synthesizer-model" | "configure-workers" | "manage-presets";
  settings: FusionSettings;
}

type WorkerPaneResult = { action: "back" } | { action: "pick-model"; target: number; index: number };

type ModelField = "discoveryModel" | "workerModel" | "synthesizerModel";

type ModelChoice = {
  spec: string;
  label: string;
  description: string;
};

function cloneSettings(settings: FusionSettings): FusionSettings {
  return { ...settings, workers: settings.workers.map((worker) => ({ ...worker })) };
}

function normalizeModelChoice(spec: string | undefined): string {
  return spec?.trim() || "current";
}

function setModelChoice(settings: FusionSettings, field: ModelField, spec: string): void {
  settings[field] = spec === "current" ? undefined : spec;
}

function formatThinkingValue(choice: string | undefined): FusionThinkingChoice {
  return (choice ?? "current") as FusionThinkingChoice;
}

function formatModelReasoning(model: string | undefined, thinking: FusionThinkingLevel | undefined, modelFallback = "current"): string {
  return `${model ?? modelFallback} · ${thinking ?? modelFallback}`;
}

function cycleThinking(current: FusionThinkingLevel | undefined, delta: -1 | 1): FusionThinkingLevel | undefined {
  const choice = formatThinkingValue(current);
  const index = Math.max(0, THINKING_CHOICES.indexOf(choice));
  const next = THINKING_CHOICES[(index + delta + THINKING_CHOICES.length) % THINKING_CHOICES.length] ?? "current";
  return next === "current" ? undefined : next;
}

function modelSpecFromModel(model: ReturnType<ExtensionContext["modelRegistry"]["getAll"]>[number]): string {
  return `${model.provider}/${model.id}`;
}

function getModelChoices(ctx: ExtensionContext): ModelChoice[] {
  const current = ctx.model ? modelSpecFromModel(ctx.model) : undefined;
  const available = ctx.modelRegistry
    .getAvailable()
    .map((model) => ({ model, spec: modelSpecFromModel(model) }))
    .sort((a, b) => a.spec.localeCompare(b.spec));

  const seen = new Set<string>();
  const choices: ModelChoice[] = [
    {
      spec: "current",
      label: "current",
      description: current ? `Use the main session model at runtime (${current})` : "Use the main session model at runtime",
    },
  ];
  seen.add("current");

  for (const { model, spec } of available) {
    if (seen.has(spec)) continue;
    seen.add(spec);
    choices.push({
      spec,
      label: spec,
      description: model.name && model.name !== model.id ? model.name : ctx.modelRegistry.getProviderDisplayName(model.provider),
    });
  }

  return choices;
}

function padToWidth(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function boxTop(theme: Theme, title: string, innerWidth: number): string {
  const border = (text: string) => theme.fg("border", text);
  const rawTitle = title.trim() ? ` ${title.trim()} ` : "";
  const shownTitle = truncateToWidth(rawTitle, innerWidth - 2, "", false);
  const styledTitle = shownTitle ? theme.fg("accent", theme.bold(shownTitle)) : "";
  const usedWidth = 1 + visibleWidth(shownTitle); // left bar + title
  const rightBars = "─".repeat(Math.max(0, innerWidth - usedWidth));
  return border("╭─") + styledTitle + border(rightBars + "╮");
}

function boxRow(theme: Theme, content: string, innerWidth: number): string {
  const border = (text: string) => theme.fg("border", text);
  return border("│") + padToWidth(truncateToWidth(content, innerWidth, "…", true), innerWidth) + border("│");
}

function boxDivider(theme: Theme, innerWidth: number): string {
  return theme.fg("border", `├${"─".repeat(innerWidth)}┤`);
}

function boxBottom(theme: Theme, innerWidth: number): string {
  return theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
}

function renderBox(theme: Theme, title: string, body: string[], width: number): string[] {
  const paneWidth = Math.max(2, width);
  const innerWidth = Math.max(1, paneWidth - 2);
  return [boxTop(theme, title, innerWidth), ...body.map((line) => boxRow(theme, line, innerWidth)), boxBottom(theme, innerWidth)];
}

function centerLines(lines: string[], width: number): string[] {
  return lines.map((line) => {
    const lineWidth = visibleWidth(line);
    if (lineWidth >= width) return truncateToWidth(line, width, "", true);
    const left = Math.floor((width - lineWidth) / 2);
    const right = width - lineWidth - left;
    return `${" ".repeat(left)}${line}${" ".repeat(right)}`;
  });
}

const SETTINGS_PANE_WIDTH = 96;
const SETTINGS_PANE_MAX_HEIGHT = 22;
const PICKER_PANE_WIDTH = 112;
const PICKER_PANE_MAX_HEIGHT = 26;

class FusionPane {
  private selected = 0;
  private readonly rows = ["enabled", "presets", "workers", "discovery", "rewrite", "synthesizer", "save"] as const;

  constructor(
    private readonly theme: Theme,
    private readonly settings: FusionSettings,
    private readonly done: (result: FusionPaneResult) => void,
    private readonly onToggleEnabled?: (enabled: boolean) => void,
  ) {}

  private toggleEnabled(): void {
    this.settings.enabled = !this.settings.enabled;
    this.onToggleEnabled?.(this.settings.enabled);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done({ action: "cancel", settings: this.settings });
      return;
    }

    if (matchesKey(data, "up")) {
      this.selected = (this.selected - 1 + this.rows.length) % this.rows.length;
      return;
    }
    if (matchesKey(data, "down")) {
      this.selected = (this.selected + 1) % this.rows.length;
      return;
    }

    const row = this.rows[this.selected];
    if (matchesKey(data, "left")) {
      this.adjust(row, -1);
      return;
    }
    if (matchesKey(data, "right")) {
      this.adjust(row, 1);
      return;
    }
    if (matchesKey(data, "space")) {
      if (row === "enabled") this.toggleEnabled();
      else if (row === "discovery") this.settings.discoveryEnabled = !this.settings.discoveryEnabled;
      else if (row === "rewrite") this.settings.rewriteEnabled = !this.settings.rewriteEnabled;
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      if (row === "presets") this.done({ action: "manage-presets", settings: this.settings });
      else if (row === "workers") this.done({ action: "configure-workers", settings: this.settings });
      else if (row === "discovery") this.done({ action: "pick-discovery-model", settings: this.settings });
      else if (row === "synthesizer") this.done({ action: "pick-synthesizer-model", settings: this.settings });
      else if (row === "save") this.done({ action: "save", settings: this.settings });
      else this.adjust(row, 1);
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const workersValue = `${this.settings.workerCount}  ${th.fg("dim", "·")}  ${th.fg("accent", "configure ▸")}`;
    const presetValue = this.settings.preset
      ? `${this.settings.preset}  ${th.fg("dim", "·")}  ${th.fg("accent", "manage ▸")}`
      : th.fg("muted", "none  ·  manage ▸");
    const discoveryValue = this.settings.discoveryEnabled
      ? formatModelReasoning(this.settings.discoveryModel, this.settings.discoveryThinking)
      : th.fg("muted", "off");
    const rows = [
      this.renderSettingRow("enabled", "Next turn", this.settings.enabled ? th.fg("success", "armed") : th.fg("muted", "off"), "space arm/disarm"),
      this.renderSettingRow("presets", "Presets", presetValue, "enter load/save/delete"),
      this.renderSettingRow("workers", "Workers", workersValue, "←/→ count • enter"),
      this.renderSettingRow("discovery", "Discovery", discoveryValue, "space on/off • enter model • ←/→ effort"),
      this.renderSettingRow("rewrite", "Rewrite", this.settings.rewriteEnabled ? th.fg("success", "on") : th.fg("muted", "off"), "space on/off"),
      this.renderSettingRow(
        "synthesizer",
        "Synthesizer",
        formatModelReasoning(this.settings.synthesizerModel, this.settings.synthesizerThinking),
        "enter model • ←/→ effort",
      ),
      this.renderSettingRow("save", "Save and close", th.fg("accent", "enter"), "esc cancel"),
    ];

    return renderBox(
      this.theme,
      "LLM Fusion",
      [
        ` ${th.fg("dim", "parallel read-only workers → one synthesizer/actor")}`,
        "",
        ...rows,
        "",
        ` ${th.fg("dim", "↑↓ move • ←/→ adjust • Enter select • Esc cancel")}`,
      ],
      width,
    );
  }

  invalidate(): void {}

  private adjust(row: (typeof this.rows)[number], delta: -1 | 1): void {
    if (row === "enabled") {
      this.toggleEnabled();
    } else if (row === "presets") {
      return;
    } else if (row === "workers") {
      this.settings.workerCount = Math.max(1, Math.min(8, this.settings.workerCount + delta));
      this.settings.workers = normalizeWorkerSlots(this.settings.workers, this.settings.workerCount);
    } else if (row === "discovery") {
      this.settings.discoveryThinking = cycleThinking(this.settings.discoveryThinking, delta);
    } else if (row === "rewrite") {
      this.settings.rewriteEnabled = !this.settings.rewriteEnabled;
    } else if (row === "synthesizer") {
      this.settings.synthesizerThinking = cycleThinking(this.settings.synthesizerThinking, delta);
    }
  }

  private renderSettingRow(row: (typeof this.rows)[number], label: string, value: string, hint: string): string {
    const isSelected = this.rows[this.selected] === row;
    const prefix = isSelected ? this.theme.fg("accent", "▶") : " ";
    const labelText = isSelected ? this.theme.fg("accent", label) : this.theme.fg("text", label);
    const labelWidth = 16;
    const hintText = hint ? this.theme.fg("dim", hint) : "";
    return ` ${prefix} ${padToWidth(labelText, labelWidth)} ${value}${hintText ? `  ${hintText}` : ""}`;
  }
}

class FusionWorkersPane {
  private selected: number;
  private readonly rowCount: number;

  constructor(
    private readonly theme: Theme,
    private readonly settings: FusionSettings,
    initialIndex: number,
    private readonly done: (result: WorkerPaneResult) => void,
  ) {
    this.rowCount = settings.workers.length + 1;
    this.selected = Math.max(0, Math.min(this.rowCount - 1, initialIndex));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done({ action: "back" });
      return;
    }
    if (matchesKey(data, "up")) {
      this.selected = (this.selected - 1 + this.rowCount) % this.rowCount;
      return;
    }
    if (matchesKey(data, "down")) {
      this.selected = (this.selected + 1) % this.rowCount;
      return;
    }
    if (matchesKey(data, "left")) {
      this.cycleReasoning(-1);
      return;
    }
    if (matchesKey(data, "right")) {
      this.cycleReasoning(1);
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.done({ action: "pick-model", target: this.selected - 1, index: this.selected });
    }
  }

  private cycleReasoning(delta: -1 | 1): void {
    if (this.selected === 0) {
      this.settings.workerThinking = cycleThinking(this.settings.workerThinking, delta);
      return;
    }
    const worker = this.settings.workers[this.selected - 1];
    if (worker) worker.thinking = cycleThinking(worker.thinking, delta);
  }

  render(width: number): string[] {
    const th = this.theme;
    const lines = [
      this.renderRow(0, "All workers", formatModelReasoning(this.settings.workerModel, this.settings.workerThinking)),
      ...this.settings.workers.map((worker, index) =>
        this.renderRow(index + 1, `#${index + 1}`, formatModelReasoning(worker.model, worker.thinking, "default")),
      ),
    ];

    return renderBox(
      this.theme,
      "Configure workers",
      [
        ` ${th.fg("dim", "per-worker model + reasoning; #N inherits 'All workers'")}`,
        "",
        ...lines,
        "",
        ` ${th.fg("dim", "↑↓ move • ←/→ effort • Enter pick model • Esc back")}`,
      ],
      width,
    );
  }

  invalidate(): void {}

  private renderRow(index: number, label: string, value: string): string {
    const isSelected = this.selected === index;
    const prefix = isSelected ? this.theme.fg("accent", "▶") : " ";
    const labelText = isSelected ? this.theme.fg("accent", label) : this.theme.fg("text", label);
    return ` ${prefix} ${padToWidth(labelText, 14)} ${value}`;
  }
}

async function pickModel(ctx: ExtensionContext, title: string, currentSpec: string | undefined, choices: ModelChoice[]): Promise<string | null> {
  const selectedSpec = normalizeModelChoice(currentSpec);

  return ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) => {
      let query = "";

      const themeCallbacks = {
        selectedPrefix: (text: string) => theme.fg("accent", text),
        selectedText: (text: string) => theme.fg("accent", text),
        description: (text: string) => theme.fg("muted", text),
        scrollInfo: (text: string) => theme.fg("dim", text),
        noMatch: (text: string) => theme.fg("warning", text),
      };

      const toItems = (filtered: ModelChoice[]): SelectItem[] =>
        filtered.map((choice) => ({
          value: choice.spec,
          label: choice.spec === selectedSpec ? `${choice.label} (selected)` : choice.label,
          description: choice.description,
        }));

      const makeList = (): SelectList => {
        const filtered = query.trim() ? fuzzyFilter(choices, query, (choice) => `${choice.spec} ${choice.label} ${choice.description}`) : choices;
        const items = toItems(filtered);
        const list = new SelectList(items, Math.max(1, Math.min(items.length, 14)), themeCallbacks);
        list.onSelect = (item) => done(item.value);
        list.onCancel = () => done(null);
        return list;
      };

      let list = makeList();
      const initialIndex = choices.findIndex((choice) => choice.spec === selectedSpec);
      if (initialIndex >= 0) list.setSelectedIndex(initialIndex);

      const container = new Container();
      const searchText = new Text("", 1, 0);
      const renderSearch = () => {
        const shown = query.length > 0 ? theme.fg("text", query) : theme.fg("dim", "(type to filter)");
        searchText.setText(`${theme.fg("accent", "›")} ${shown}${theme.fg("accent", "▌")}`);
      };
      const rebuild = () => {
        container.clear();
        container.addChild(searchText);
        container.addChild(list);
        container.addChild(new Text(theme.fg("dim", "type to fuzzy-filter • ↑↓ navigate • enter select • esc back"), 1, 0));
      };
      renderSearch();
      rebuild();

      const refilter = () => {
        list = makeList();
        renderSearch();
        rebuild();
        tui.requestRender();
      };

      return {
        render(width: number) {
          const paneWidth = Math.max(2, width);
          const innerWidth = Math.max(1, paneWidth - 2);
          return renderBox(theme, title, container.render(innerWidth), paneWidth);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          if (
            matchesKey(data, "up") ||
            matchesKey(data, "down") ||
            matchesKey(data, "return") ||
            matchesKey(data, "enter") ||
            matchesKey(data, "escape") ||
            matchesKey(data, "ctrl+c")
          ) {
            list.handleInput(data);
            tui.requestRender();
            return;
          }
          if (matchesKey(data, "backspace")) {
            if (query.length > 0) {
              query = query.slice(0, -1);
              refilter();
            }
            return;
          }
          if (data.length === 1 && data >= " ") {
            query += data;
            refilter();
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: PICKER_PANE_WIDTH, maxHeight: PICKER_PANE_MAX_HEIGHT, margin: 2 },
    },
  );
}

function describePreset(preset: LoadedFusionPreset): string {
  const settings = preset.settings;
  const workers = settings.workerCount === undefined ? "workers:current" : `workers:${settings.workerCount}`;
  const workerModel = settings.workerModel ?? "worker:current";
  const synthesizerModel = settings.synthesizerModel ?? "synth:current";
  const scope = preset.scope === "project" ? "project" : "global";
  const description = preset.description ? `${preset.description} · ` : "";
  return `${description}${scope} · ${workers} · ${workerModel} → ${synthesizerModel}`;
}

async function showFusionPresetManager(ctx: ExtensionContext, draft: FusionSettings): Promise<FusionSettings> {
  const presets = await loadFusionPresets(ctx.cwd);
  const items: SelectItem[] = [
    {
      value: "save-global",
      label: "Save current settings as a global preset",
      description: "Writes to ~/.pi/agent/fusion.json",
    },
    {
      value: "save-project",
      label: "Save current settings as a project preset",
      description: "Writes to .pi/fusion.json in this repository",
    },
    ...presets.map((preset) => ({
      value: `load:${preset.name}`,
      label: preset.name === draft.preset ? `${preset.name} (loaded)` : preset.name,
      description: describePreset(preset),
    })),
    ...presets.map((preset) => ({
      value: `delete:${preset.scope}:${preset.name}`,
      label: `Delete ${preset.name}`,
      description: `Remove the ${preset.scope} preset from ${preset.path}`,
    })),
  ];

  const choice = await ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) => {
      const list = new SelectList(items, Math.min(Math.max(items.length, 1), 14), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => done(null);

      const container = new Container();
      container.addChild(new Text(theme.fg("dim", "Saved settings snapshots. Project presets override global presets with the same name."), 1, 0));
      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc back"), 1, 0));

      return {
        render(width: number) {
          const paneWidth = Math.max(2, width);
          const innerWidth = Math.max(1, paneWidth - 2);
          return renderBox(theme, "Fusion presets", container.render(innerWidth), paneWidth);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          list.handleInput(data);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: PICKER_PANE_WIDTH, maxHeight: PICKER_PANE_MAX_HEIGHT, margin: 2 },
    },
  );

  if (!choice) return draft;

  if (choice === "save-global" || choice === "save-project") {
    const name = await ctx.ui.input("Preset name", draft.preset ?? "");
    if (!name?.trim()) return draft;
    const description = await ctx.ui.input("Preset description (optional)", "");
    const scope = choice === "save-project" ? "project" : "global";
    const savedPath = await saveFusionPreset(ctx.cwd, name, draft, scope, description);
    ctx.ui.notify(`Saved fusion preset "${name.trim()}" to ${savedPath}`, "info");
    return { ...draft, preset: name.trim() };
  }

  if (choice.startsWith("load:")) {
    const name = choice.slice("load:".length);
    const preset = presets.find((candidate) => candidate.name === name);
    if (!preset) {
      ctx.ui.notify(`Preset "${name}" no longer exists`, "warning");
      return draft;
    }
    ctx.ui.notify(`Loaded fusion preset "${name}"`, "info");
    return applyFusionPresetSettings(draft, name, preset);
  }

  if (choice.startsWith("delete:")) {
    const [, scope, name] = choice.split(":");
    if ((scope !== "global" && scope !== "project") || !name) return draft;
    const ok = await ctx.ui.confirm(
      `Delete preset "${name}"?`,
      `This removes it from ${scope === "global" ? "~/.pi/agent/fusion.json" : ".pi/fusion.json"}.`,
    );
    if (!ok) return draft;
    const deleted = await deleteFusionPreset(ctx.cwd, name, scope);
    ctx.ui.notify(deleted ? `Deleted fusion preset "${name}"` : `Preset "${name}" was already gone`, deleted ? "info" : "warning");
    return draft.preset === name ? { ...draft, preset: undefined } : draft;
  }

  return draft;
}

async function configureWorkers(ctx: ExtensionContext, draft: FusionSettings, choices: ModelChoice[]): Promise<void> {
  let selected = 0;

  while (true) {
    const result = await ctx.ui.custom<WorkerPaneResult>(
      (tui, theme, _keybindings, done) => {
        const pane = new FusionWorkersPane(theme, draft, selected, done);
        return {
          render(width: number) {
            return pane.render(width);
          },
          invalidate() {
            pane.invalidate();
          },
          handleInput(data: string) {
            pane.handleInput(data);
            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: SETTINGS_PANE_WIDTH, maxHeight: SETTINGS_PANE_MAX_HEIGHT, margin: 2 },
      },
    );

    if (!result || result.action === "back") return;
    selected = result.index;

    const target = result.target;
    const currentSpec = target < 0 ? draft.workerModel : draft.workers[target]?.model;
    const title = target < 0 ? "Select default worker model" : `Select model for worker #${target + 1}`;
    const picked = await pickModel(ctx, title, currentSpec, choices);
    if (picked === null) continue;
    const model = picked === "current" ? undefined : picked;
    if (target < 0) draft.workerModel = model;
    else if (draft.workers[target]) draft.workers[target].model = model;
  }
}

export async function showFusionPane(
  ctx: ExtensionContext,
  initialSettings: FusionSettings,
  onToggleEnabled?: (enabled: boolean) => void,
): Promise<FusionSettings | undefined> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/fusion UI requires TUI mode", "error");
    return undefined;
  }

  const choices = getModelChoices(ctx);
  let draft = cloneSettings(initialSettings);

  while (true) {
    const result = await ctx.ui.custom<FusionPaneResult>(
      (tui, theme, _keybindings, done) => {
        const pane = new FusionPane(theme, cloneSettings(draft), done, (enabled) => {
          draft.enabled = enabled;
          onToggleEnabled?.(enabled);
        });
        return {
          render(width: number) {
            return pane.render(width);
          },
          invalidate() {
            pane.invalidate();
          },
          handleInput(data: string) {
            pane.handleInput(data);
            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: SETTINGS_PANE_WIDTH, maxHeight: SETTINGS_PANE_MAX_HEIGHT, margin: 2 },
      },
    );

    if (!result || result.action === "cancel") return undefined;
    draft = cloneSettings(result.settings);

    if (result.action === "save") return draft;

    if (result.action === "manage-presets") {
      draft = cloneSettings(await showFusionPresetManager(ctx, draft));
      continue;
    }

    if (result.action === "configure-workers") {
      await configureWorkers(ctx, draft, choices);
      continue;
    }

    const field = result.action === "pick-discovery-model" ? "discoveryModel" : "synthesizerModel";
    const title = field === "discoveryModel" ? "Select discovery model" : "Select synthesizer model";
    const selected = await pickModel(ctx, title, draft[field], choices);
    if (selected !== null) setModelChoice(draft, field, selected);
  }
}

export interface FusionLiveWorkerState {
  index: number;
  label: string;
  lens: string;
  prompt?: string;
  status: "queued" | "running" | "done" | "failed" | "timed-out";
  startedAt?: number;
  updatedAt?: number;
  output: string;
  reasoning: string;
  events: string[];
}

export interface FusionLivePanelController {
  update(index: number, patch: Partial<Omit<FusionLiveWorkerState, "index">>): void;
  close(): void;
}

function tailText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `…${text.slice(text.length - maxChars)}`;
}

function wrapPlainText(text: string, width: number, maxLines: number): string[] {
  if (maxLines <= 0) return [];
  const normalized = text.trimEnd();
  if (!normalized) return [];
  const safeWidth = Math.max(1, width);
  if (safeWidth < 4) {
    const narrowLines = normalized.split("\n").map((line) => truncateToWidth(line, safeWidth, "", true));
    return narrowLines.length <= maxLines
      ? narrowLines
      : [truncateToWidth("…", safeWidth, "", true), ...narrowLines.slice(narrowLines.length - maxLines + 1)];
  }
  const lines: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    let remaining = rawLine;
    if (!remaining) {
      lines.push("");
      continue;
    }

    while (visibleWidth(remaining) > safeWidth) {
      let sliceLength = Math.min(remaining.length, safeWidth);
      while (sliceLength > 1 && visibleWidth(remaining.slice(0, sliceLength)) > safeWidth) sliceLength--;
      lines.push(remaining.slice(0, sliceLength));
      remaining = remaining.slice(sliceLength);
    }
    lines.push(remaining);
  }

  if (lines.length <= maxLines) return lines;
  return ["…", ...lines.slice(lines.length - maxLines + 1)];
}

const MIN_COLUMN_WIDTH = 24;

function splitWidths(total: number, count: number): number[] {
  const base = Math.max(1, Math.floor(total / count));
  const widths = Array.from({ length: count }, () => base);
  let remainder = total - base * count;
  for (let i = 0; i < widths.length && remainder > 0; i++, remainder--) widths[i]++;
  return widths;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m${remainingSeconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

function collapseEvents(events: string[]): string[] {
  const out: string[] = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.replace(/ ×\d+$/, "") === event) {
      const match = prev.match(/ ×(\d+)$/);
      out[out.length - 1] = `${event} ×${match ? Number(match[1]) + 1 : 2}`;
    } else {
      out.push(event);
    }
  }
  return out;
}

function formatWorkerTiming(worker: FusionLiveWorkerState): string {
  const now = Date.now();
  const parts: string[] = [];
  if (worker.startedAt !== undefined) parts.push(`run ${formatDuration(now - worker.startedAt)}`);
  if (worker.updatedAt !== undefined) parts.push(`last ${formatDuration(now - worker.updatedAt)}`);
  return parts.length > 0 ? `(${parts.join(" • ")})` : "";
}

class FusionLivePanel {
  private closed = false;
  private focusIndex: number | null = null;
  private showPrompts = false;
  private readonly renderTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly workers: FusionLiveWorkerState[],
    private readonly title: string,
    private readonly done: () => void,
    private readonly onCancel?: () => void,
  ) {
    this.renderTimer = setInterval(() => {
      if (this.workers.some((worker) => worker.status === "running")) this.tui.requestRender();
    }, 500);
    this.renderTimer.unref?.();
  }

  update(index: number, patch: Partial<Omit<FusionLiveWorkerState, "index">>): void {
    const worker = this.workers[index];
    if (!worker || this.closed) return;
    Object.assign(worker, patch);
    const now = Date.now();
    if (patch.status === "running" && worker.startedAt === undefined) worker.startedAt = now;
    worker.updatedAt = now;
    worker.output = tailText(worker.output, 16_000);
    worker.reasoning = tailText(worker.reasoning, 16_000);
    worker.events = worker.events.slice(-20);
    this.tui.requestRender();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.renderTimer);
    this.done();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onCancel?.();
      this.close();
      return;
    }
    if (data === "p" || data === "P") {
      this.showPrompts = !this.showPrompts;
      this.tui.requestRender();
      return;
    }
    if (data === "0" || matchesKey(data, "tab")) {
      this.focusIndex = null;
      this.tui.requestRender();
      return;
    }
    if (data.length === 1 && data >= "1" && data <= "9") {
      const index = Number(data) - 1;
      if (index < this.workers.length) {
        this.focusIndex = index;
        this.tui.requestRender();
      }
    }
  }

  render(width: number): string[] {
    const panelWidth = Math.max(20, Math.min(width, 160));
    const innerWidth = Math.max(1, panelWidth - 2);
    const count = Math.max(1, this.workers.length);
    const naturalCol = Math.floor((innerWidth - (count - 1)) / count);
    const focus = this.effectiveFocus(count, naturalCol);

    const lines = [
      boxTop(this.theme, this.headerTitle(), innerWidth),
      boxRow(this.theme, this.controlsLine(focus), innerWidth),
      boxDivider(this.theme, innerWidth),
    ];

    if (focus === null) {
      const colWidths = splitWidths(Math.max(count, innerWidth - (count - 1)), count);
      const separator = this.theme.fg("border", "│");
      const workerLines = this.workers.map((worker, index) =>
        this.renderWorker(worker, colWidths[index] ?? 1, { showPrompt: this.showPrompts, reasoningLines: 4, outputLines: 8 }),
      );
      const maxLines = Math.max(...workerLines.map((cells) => cells.length));
      for (let i = 0; i < maxLines; i++) {
        const cells = workerLines.map((workerCells, index) => {
          const colWidth = colWidths[index] ?? 1;
          return padToWidth(truncateToWidth(workerCells[i] ?? "", colWidth, "…", true), colWidth);
        });
        lines.push(boxRow(this.theme, cells.join(separator), innerWidth));
      }
    } else {
      const body = this.renderWorker(this.workers[focus], innerWidth, { showPrompt: this.showPrompts, reasoningLines: 8, outputLines: 18 });
      for (const line of body) lines.push(boxRow(this.theme, line, innerWidth));
    }

    lines.push(boxBottom(this.theme, innerWidth));
    return centerLines(lines, width);
  }

  private effectiveFocus(count: number, naturalCol: number): number | null {
    if (this.focusIndex !== null && this.focusIndex >= 0 && this.focusIndex < count) return this.focusIndex;
    if (count > 1 && naturalCol < MIN_COLUMN_WIDTH) return 0;
    return null;
  }

  private headerTitle(): string {
    const total = this.workers.length;
    if (total <= 1) return this.title;
    const doneCount = this.workers.filter((worker) => worker.status === "done" || worker.status === "failed" || worker.status === "timed-out").length;
    return `${this.title} ${doneCount}/${total}`;
  }

  private hasPrompts(): boolean {
    return this.workers.some((worker) => Boolean(worker.prompt));
  }

  private statusIcon(status: FusionLiveWorkerState["status"]): string {
    return {
      queued: this.theme.fg("dim", "○"),
      running: this.theme.fg("warning", "◐"),
      done: this.theme.fg("success", "●"),
      failed: this.theme.fg("error", "⊘"),
      "timed-out": this.theme.fg("warning", "◌"),
    }[status];
  }

  private controlsLine(focus: number | null): string {
    const promptHint = this.hasPrompts() ? " • p prompts" : "";
    if (this.workers.length <= 1) {
      return ` ${this.theme.fg("dim", `esc cancel${promptHint}`)}`;
    }
    const tabs = this.workers
      .map((worker, index) => {
        const label = `${index + 1}${this.statusIcon(worker.status)}`;
        return index === focus ? this.theme.fg("accent", `[${label}]`) : this.theme.fg("muted", ` ${label} `);
      })
      .join("");
    const nav = focus === null ? "1-9 focus" : "0 split • 1-9 switch";
    return ` ${tabs}   ${this.theme.fg("dim", `${nav}${promptHint} • esc cancel`)}`;
  }

  invalidate(): void {}
  dispose(): void {
    this.closed = true;
    clearInterval(this.renderTimer);
  }

  private renderWorker(
    worker: FusionLiveWorkerState,
    width: number,
    opts: { showPrompt: boolean; reasoningLines: number; outputLines: number },
  ): string[] {
    const timing = formatWorkerTiming(worker);
    const head = `${this.statusIcon(worker.status)} ${this.theme.fg("accent", worker.label)} ${this.theme.fg("muted", worker.lens)}${timing ? this.theme.fg("dim", ` ${timing}`) : ""}`;

    const promptBlock = opts.showPrompt && worker.prompt ? [this.theme.fg("dim", "prompt"), ...wrapPlainText(worker.prompt, width, 4), ""] : [];
    const reasoningLines = wrapPlainText(
      worker.reasoning || (worker.status === "running" ? "(no reasoning stream yet; model/provider may hide it)" : "(no reasoning stream)"),
      width,
      opts.reasoningLines,
    );
    const collapsed = collapseEvents(worker.events);
    const eventText = collapsed.length > 0 ? `\n${collapsed.map((event) => `→ ${event}`).join("\n")}` : "";
    const outputLines = wrapPlainText(
      worker.output || eventText || (worker.status === "running" ? "(waiting for output…)" : "(no output)"),
      width,
      opts.outputLines,
    );

    return [head, ...promptBlock, this.theme.fg("dim", "reasoning"), ...reasoningLines, "", this.theme.fg("dim", "output"), ...outputLines];
  }
}

export function startFusionLivePanel(
  ctx: ExtensionContext,
  workers: FusionLiveWorkerState[],
  title = "LLM Fusion planners",
  onCancel?: () => void,
): FusionLivePanelController | undefined {
  if (ctx.mode !== "tui") return undefined;

  let panel: FusionLivePanel | undefined;
  let close: (() => void) | undefined;

  void ctx.ui
    .custom<void>(
      (tui, theme, _keybindings, done) => {
        panel = new FusionLivePanel(
          tui,
          theme,
          workers.map((worker) => ({ ...worker })),
          title,
          done,
          onCancel,
        );
        close = () => panel?.close();
        return panel;
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "95%", maxHeight: "85%", margin: 1 },
      },
    )
    .catch(() => undefined);

  return {
    update(index, patch) {
      panel?.update(index, patch);
    },
    close() {
      close?.();
    },
  };
}
