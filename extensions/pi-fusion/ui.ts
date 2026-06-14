import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, type SelectItem, SelectList, Text, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import {
  normalizeWorkerSlots,
  THINKING_CHOICES,
  type FusionSettings,
  type FusionThinkingChoice,
  type FusionThinkingLevel,
} from "./fusion.ts";

interface FusionPaneResult {
  action: "save" | "cancel" | "pick-discovery-model" | "pick-synthesizer-model" | "configure-workers";
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

class FusionPane {
  private selected = 0;
  private readonly rows = ["enabled", "workers", "discovery", "synthesizer", "save"] as const;

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
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      if (row === "workers") this.done({ action: "configure-workers", settings: this.settings });
      else if (row === "discovery") this.done({ action: "pick-discovery-model", settings: this.settings });
      else if (row === "synthesizer") this.done({ action: "pick-synthesizer-model", settings: this.settings });
      else if (row === "save") this.done({ action: "save", settings: this.settings });
      else this.adjust(row, 1);
    }
  }

  render(width: number): string[] {
    const paneWidth = Math.max(2, Math.min(width, 78));
    const innerWidth = Math.max(1, paneWidth - 2);
    const th = this.theme;
    const border = (text: string) => th.fg("border", text);
    const row = (content: string) => border("│") + padToWidth(truncateToWidth(content, innerWidth, "…", true), innerWidth) + border("│");

    const workersValue = `${this.settings.workerCount}  ${th.fg("dim", "·")}  ${th.fg("accent", "configure ▸")}`;
    const rows = [
      this.renderSettingRow("enabled", "Enabled", this.settings.enabled ? th.fg("success", "on") : th.fg("muted", "off"), "space (applies now)"),
      this.renderSettingRow("workers", "Workers", workersValue, "←/→ count • enter"),
      this.renderSettingRow("discovery", "Discovery", formatModelReasoning(this.settings.discoveryModel, this.settings.discoveryThinking), "enter model • ←/→ effort"),
      this.renderSettingRow("synthesizer", "Synthesizer", formatModelReasoning(this.settings.synthesizerModel, this.settings.synthesizerThinking), "enter model • ←/→ effort"),
      this.renderSettingRow("save", "Save and close", th.fg("accent", "enter"), "esc cancel"),
    ];

    const title = truncateToWidth(" LLM Fusion ", innerWidth, "", true);
    const titleWidth = visibleWidth(title);
    const left = "─".repeat(Math.max(0, Math.floor((innerWidth - titleWidth) / 2)));
    const right = "─".repeat(Math.max(0, innerWidth - titleWidth - left.length));

    return [
      border(`╭${left}`) + th.fg("accent", th.bold(title)) + border(`${right}╮`),
      row(` ${th.fg("dim", "parallel read-only workers → one synthesizer/actor")}`),
      row(""),
      ...rows.map((content) => row(content)),
      row(""),
      row(` ${th.fg("dim", "↑↓ move • ←/→ adjust • Enter select • Esc cancel")}`),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  invalidate(): void {}

  private adjust(row: (typeof this.rows)[number], delta: -1 | 1): void {
    if (row === "enabled") {
      this.toggleEnabled();
    } else if (row === "workers") {
      this.settings.workerCount = Math.max(1, Math.min(8, this.settings.workerCount + delta));
      this.settings.workers = normalizeWorkerSlots(this.settings.workers, this.settings.workerCount);
    } else if (row === "discovery") {
      this.settings.discoveryThinking = cycleThinking(this.settings.discoveryThinking, delta);
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
    const paneWidth = Math.max(2, Math.min(width, 78));
    const innerWidth = Math.max(1, paneWidth - 2);
    const th = this.theme;
    const border = (text: string) => th.fg("border", text);
    const row = (content: string) => border("│") + padToWidth(truncateToWidth(content, innerWidth, "…", true), innerWidth) + border("│");

    const lines = [
      this.renderRow(0, "All workers", formatModelReasoning(this.settings.workerModel, this.settings.workerThinking)),
      ...this.settings.workers.map((worker, index) =>
        this.renderRow(index + 1, `#${index + 1}`, formatModelReasoning(worker.model, worker.thinking, "default")),
      ),
    ];

    const title = truncateToWidth(" Configure workers ", innerWidth, "", true);
    const titleWidth = visibleWidth(title);
    const left = "─".repeat(Math.max(0, Math.floor((innerWidth - titleWidth) / 2)));
    const right = "─".repeat(Math.max(0, innerWidth - titleWidth - left.length));

    return [
      border(`╭${left}`) + th.fg("accent", th.bold(title)) + border(`${right}╮`),
      row(` ${th.fg("dim", "per-worker model + reasoning; #N inherits 'All workers'")}`),
      row(""),
      ...lines.map((content) => row(content)),
      row(""),
      row(` ${th.fg("dim", "↑↓ move • ←/→ effort • Enter pick model • Esc back")}`),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
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
  const items: SelectItem[] = choices.map((choice) => ({
    value: choice.spec,
    label: choice.spec === normalizeModelChoice(currentSpec) ? `${choice.label} (selected)` : choice.label,
    description: choice.description,
  }));

  return ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
      container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

      const selectList = new SelectList(items, Math.min(items.length, 16), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });
      const selectedIndex = items.findIndex((item) => item.value === normalizeModelChoice(currentSpec));
      if (selectedIndex >= 0) selectList.setSelectedIndex(selectedIndex);
      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);
      container.addChild(new Text(theme.fg("dim", "type to filter • ↑↓ navigate • enter select • esc back"), 1, 0));
      container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "75%", minWidth: 60, maxHeight: "80%", margin: 2 },
    },
  );
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
        overlayOptions: { anchor: "center", width: 78, maxHeight: 18, margin: 2 },
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
        overlayOptions: { anchor: "center", width: 78, maxHeight: 14, margin: 2 },
      },
    );

    if (!result || result.action === "cancel") return undefined;
    draft = cloneSettings(result.settings);

    if (result.action === "save") return draft;

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
    return narrowLines.length <= maxLines ? narrowLines : [truncateToWidth("…", safeWidth, "", true), ...narrowLines.slice(narrowLines.length - maxLines + 1)];
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
    const border = (text: string) => this.theme.fg("border", text);
    const count = Math.max(1, this.workers.length);
    const naturalCol = Math.floor((innerWidth - (count - 1)) / count);
    const focus = this.effectiveFocus(count, naturalCol);

    const lines = [
      border(`╭${"─".repeat(innerWidth)}╮`),
      this.wrapLine(this.headerText(), innerWidth, border),
      this.wrapLine(this.tabBar(focus), innerWidth, border),
      border(`├${"─".repeat(innerWidth)}┤`),
    ];

    if (focus === null) {
      const colWidths = splitWidths(Math.max(count, innerWidth - (count - 1)), count);
      const separator = border("│");
      const workerLines = this.workers.map((worker, index) =>
        this.renderWorker(worker, colWidths[index] ?? 1, { showPrompt: this.showPrompts, reasoningLines: 4, outputLines: 8 }),
      );
      const maxLines = Math.max(...workerLines.map((cells) => cells.length));
      for (let i = 0; i < maxLines; i++) {
        const cells = workerLines.map((workerCells, index) => {
          const colWidth = colWidths[index] ?? 1;
          return padToWidth(truncateToWidth(workerCells[i] ?? "", colWidth, "…", true), colWidth);
        });
        lines.push(border("│") + cells.join(separator) + border("│"));
      }
    } else {
      const body = this.renderWorker(this.workers[focus], innerWidth, { showPrompt: this.showPrompts, reasoningLines: 8, outputLines: 18 });
      for (const line of body) lines.push(this.wrapLine(line, innerWidth, border));
    }

    lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  private effectiveFocus(count: number, naturalCol: number): number | null {
    if (this.focusIndex !== null && this.focusIndex >= 0 && this.focusIndex < count) return this.focusIndex;
    if (count > 1 && naturalCol < MIN_COLUMN_WIDTH) return 0;
    return null;
  }

  private wrapLine(line: string, innerWidth: number, border: (text: string) => string): string {
    return border("│") + padToWidth(truncateToWidth(line, innerWidth, "…", true), innerWidth) + border("│");
  }

  private headerText(): string {
    const doneCount = this.workers.filter((worker) => worker.status === "done" || worker.status === "failed" || worker.status === "timed-out").length;
    return this.theme.fg("accent", this.theme.bold(` ${this.title} ${doneCount}/${this.workers.length} `));
  }

  private statusIcon(status: FusionLiveWorkerState["status"]): string {
    return {
      queued: this.theme.fg("dim", "○"),
      running: this.theme.fg("warning", "⏳"),
      done: this.theme.fg("success", "✓"),
      failed: this.theme.fg("error", "✗"),
      "timed-out": this.theme.fg("warning", "⌛"),
    }[status];
  }

  private tabBar(focus: number | null): string {
    const tabs = this.workers
      .map((worker, index) => {
        const label = `${index + 1}${this.statusIcon(worker.status)}`;
        return index === focus ? this.theme.fg("accent", `[${label}]`) : this.theme.fg("muted", ` ${label} `);
      })
      .join("");
    const controls = this.theme.fg("dim", focus === null ? "1-9 focus • p prompts • esc cancel" : "0 split • 1-9 switch • p prompts • esc cancel");
    return ` ${tabs}   ${controls}`;
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

    const promptBlock =
      opts.showPrompt && worker.prompt ? [this.theme.fg("dim", "prompt"), ...wrapPlainText(worker.prompt, width, 4), ""] : [];
    const reasoningLines = wrapPlainText(
      worker.reasoning || (worker.status === "running" ? "(no reasoning stream yet; model/provider may hide it)" : "(no reasoning stream)"),
      width,
      opts.reasoningLines,
    );
    const eventText = worker.events.length > 0 ? `\n${worker.events.map((event) => `→ ${event}`).join("\n")}` : "";
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
        panel = new FusionLivePanel(tui, theme, workers.map((worker) => ({ ...worker })), title, done, onCancel);
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
