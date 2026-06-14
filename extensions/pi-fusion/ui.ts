import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, type SelectItem, SelectList, Text, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { THINKING_CHOICES, type FusionSettings, type FusionThinkingChoice } from "./fusion.ts";

interface FusionPaneResult {
  action: "save" | "cancel" | "pick-discovery-model" | "pick-worker-model" | "pick-synthesizer-model";
  settings: FusionSettings;
}

type ModelField = "discoveryModel" | "workerModel" | "synthesizerModel";

type ModelChoice = {
  spec: string;
  label: string;
  description: string;
};

function cloneSettings(settings: FusionSettings): FusionSettings {
  return { ...settings };
}

function normalizeModelChoice(spec: string | undefined): string {
  return spec?.trim() || "current";
}

function setModelChoice(settings: FusionSettings, field: ModelField, spec: string): void {
  settings[field] = spec === "current" ? undefined : spec;
}

function formatModelValue(spec: string | undefined): string {
  return spec ?? "current";
}

function formatThinkingValue(choice: string | undefined): FusionThinkingChoice {
  return (choice ?? "current") as FusionThinkingChoice;
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
  private readonly rows = [
    "enabled",
    "workers",
    "discoveryModel",
    "discoveryThinking",
    "workerModel",
    "workerThinking",
    "synthesizerModel",
    "synthesizerThinking",
    "save",
  ] as const;

  constructor(
    private readonly theme: Theme,
    private readonly settings: FusionSettings,
    private readonly modelSpecs: string[],
    private readonly done: (result: FusionPaneResult) => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done({ action: "cancel", settings: this.settings });
      return;
    }

    if (matchesKey(data, "up")) {
      this.selected = Math.max(0, this.selected - 1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.selected = Math.min(this.rows.length - 1, this.selected + 1);
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
      if (row === "enabled") this.settings.enabled = !this.settings.enabled;
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      if (row === "discoveryModel") this.done({ action: "pick-discovery-model", settings: this.settings });
      else if (row === "workerModel") this.done({ action: "pick-worker-model", settings: this.settings });
      else if (row === "synthesizerModel") this.done({ action: "pick-synthesizer-model", settings: this.settings });
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

    const rows = [
      this.renderSettingRow("enabled", "Enabled", this.settings.enabled ? th.fg("success", "on") : th.fg("muted", "off"), "space"),
      this.renderSettingRow("workers", "Workers", String(this.settings.workerCount), "←/→"),
      this.renderSettingRow("discoveryModel", "Discovery model", formatModelValue(this.settings.discoveryModel), "enter pick"),
      this.renderSettingRow("discoveryThinking", "Discovery reasoning", formatThinkingValue(this.settings.discoveryThinking), "←/→"),
      this.renderSettingRow("workerModel", "Worker model", formatModelValue(this.settings.workerModel), "enter pick"),
      this.renderSettingRow("workerThinking", "Worker reasoning", formatThinkingValue(this.settings.workerThinking), "←/→"),
      this.renderSettingRow("synthesizerModel", "Synth model", formatModelValue(this.settings.synthesizerModel), "enter pick"),
      this.renderSettingRow("synthesizerThinking", "Synth reasoning", formatThinkingValue(this.settings.synthesizerThinking), "←/→"),
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
      row(` ${th.fg("dim", "↑↓ move • ←/→ adjust/cycle • Enter select/save • Esc cancel")}`),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  invalidate(): void {}

  private adjust(row: (typeof this.rows)[number], delta: -1 | 1): void {
    if (row === "enabled") {
      this.settings.enabled = !this.settings.enabled;
    } else if (row === "workers") {
      this.settings.workerCount = Math.max(1, Math.min(8, this.settings.workerCount + delta));
    } else if (row === "discoveryModel") {
      this.cycleModel("discoveryModel", delta);
    } else if (row === "discoveryThinking") {
      this.cycleThinking("discoveryThinking", delta);
    } else if (row === "workerModel") {
      this.cycleModel("workerModel", delta);
    } else if (row === "workerThinking") {
      this.cycleThinking("workerThinking", delta);
    } else if (row === "synthesizerModel") {
      this.cycleModel("synthesizerModel", delta);
    } else if (row === "synthesizerThinking") {
      this.cycleThinking("synthesizerThinking", delta);
    }
  }

  private cycleModel(field: ModelField, delta: -1 | 1): void {
    if (this.modelSpecs.length === 0) return;
    const current = normalizeModelChoice(this.settings[field]);
    const index = Math.max(0, this.modelSpecs.indexOf(current));
    const next = this.modelSpecs[(index + delta + this.modelSpecs.length) % this.modelSpecs.length] ?? "current";
    setModelChoice(this.settings, field, next);
  }

  private cycleThinking(field: "discoveryThinking" | "workerThinking" | "synthesizerThinking", delta: -1 | 1): void {
    const current = formatThinkingValue(this.settings[field]);
    const index = Math.max(0, THINKING_CHOICES.indexOf(current));
    const next = THINKING_CHOICES[(index + delta + THINKING_CHOICES.length) % THINKING_CHOICES.length] ?? "current";
    this.settings[field] = next === "current" ? undefined : next;
  }

  private renderSettingRow(row: (typeof this.rows)[number], label: string, value: string, hint: string): string {
    const isSelected = this.rows[this.selected] === row;
    const prefix = isSelected ? this.theme.fg("accent", "▶") : " ";
    const labelText = isSelected ? this.theme.fg("accent", label) : this.theme.fg("text", label);
    const labelWidth = 20;
    const hintText = hint ? this.theme.fg("dim", hint) : "";
    return ` ${prefix} ${padToWidth(labelText, labelWidth)} ${value}${hintText ? ` ${hintText}` : ""}`;
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

export async function showFusionPane(ctx: ExtensionContext, initialSettings: FusionSettings): Promise<FusionSettings | undefined> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/fusion UI requires TUI mode", "error");
    return undefined;
  }

  const choices = getModelChoices(ctx);
  const modelSpecs = choices.map((choice) => choice.spec);
  let draft = cloneSettings(initialSettings);

  while (true) {
    const result = await ctx.ui.custom<FusionPaneResult>(
      (tui, theme, _keybindings, done) => {
        const pane = new FusionPane(theme, cloneSettings(draft), modelSpecs, done);
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
        overlayOptions: { anchor: "center", width: 78, maxHeight: 16, margin: 2 },
      },
    );

    if (!result || result.action === "cancel") return undefined;
    draft = cloneSettings(result.settings);

    if (result.action === "save") return draft;

    const field = result.action === "pick-discovery-model" ? "discoveryModel" : result.action === "pick-worker-model" ? "workerModel" : "synthesizerModel";
    const title = field === "discoveryModel" ? "Select discovery model" : field === "workerModel" ? "Select worker model" : "Select synthesizer model";
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
  private readonly renderTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly workers: FusionLiveWorkerState[],
    private readonly title: string,
    private readonly done: () => void,
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
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) this.close();
  }

  render(width: number): string[] {
    const panelWidth = Math.max(20, Math.min(width, 160));
    const count = Math.max(1, this.workers.length);
    const contentWidth = Math.max(count, panelWidth - count - 1);
    const colWidths = splitWidths(contentWidth, count);
    const border = (text: string) => this.theme.fg("border", text);
    const separator = border("│");

    const borderLine = (left: string, middle: string, right: string, fill: string) =>
      border(left) + colWidths.map((colWidth) => border(fill.repeat(colWidth))).join(border(middle)) + border(right);

    const row = (cells: string[]) =>
      separator +
      cells
        .map((cell, index) => {
          const width = colWidths[index] ?? 1;
          return padToWidth(truncateToWidth(cell, width, "…", true), width);
        })
        .join(separator) +
      separator;

    const doneCount = this.workers.filter((worker) => worker.status === "done" || worker.status === "failed" || worker.status === "timed-out").length;
    const headerText = this.theme.fg("accent", this.theme.bold(` ${this.title} ${doneCount}/${this.workers.length} `));
    const headerLine = truncateToWidth(headerText, Math.max(1, panelWidth - 2), "…", true);
    const headerPadding = Math.max(0, panelWidth - 2 - visibleWidth(headerLine));

    const workerLines = this.workers.map((worker, index) => this.renderWorker(worker, colWidths[index] ?? 1));
    const maxWorkerLines = Math.max(...workerLines.map((lines) => lines.length));
    const lines = [
      border(`╭${"─".repeat(panelWidth - 2)}╮`),
      border("│") + headerLine + " ".repeat(headerPadding) + border("│"),
      borderLine("├", "┬", "┤", "─"),
    ];

    for (let lineIndex = 0; lineIndex < maxWorkerLines; lineIndex++) {
      lines.push(row(workerLines.map((worker) => worker[lineIndex] ?? "")));
    }

    lines.push(borderLine("╰", "┴", "╯", "─"));
    return lines;
  }

  invalidate(): void {}
  dispose(): void {
    this.closed = true;
    clearInterval(this.renderTimer);
  }

  private renderWorker(worker: FusionLiveWorkerState, width: number): string[] {
    const statusIcon = {
      queued: this.theme.fg("dim", "○"),
      running: this.theme.fg("warning", "⏳"),
      done: this.theme.fg("success", "✓"),
      failed: this.theme.fg("error", "✗"),
      "timed-out": this.theme.fg("warning", "⌛"),
    }[worker.status];

    const promptLines = worker.prompt ? wrapPlainText(worker.prompt, width, 4) : [];
    const reasoningLines = wrapPlainText(
      worker.reasoning || (worker.status === "running" ? "(no reasoning stream yet; model/provider may hide it)" : "(no reasoning stream)"),
      width,
      worker.prompt ? 4 : 6,
    );
    const eventText = worker.events.length > 0 ? `\n${worker.events.map((event) => `→ ${event}`).join("\n")}` : "";
    const outputLines = wrapPlainText(worker.output || eventText || (worker.status === "running" ? "(waiting for output…)" : "(no output)"), width, 10);

    const timing = formatWorkerTiming(worker);

    return [
      `${statusIcon} ${this.theme.fg("accent", worker.label)} ${this.theme.fg("muted", worker.lens)}${timing ? this.theme.fg("dim", ` ${timing}`) : ""}`,
      ...(promptLines.length > 0 ? [this.theme.fg("dim", "prompt"), ...promptLines, ""] : []),
      this.theme.fg("dim", "reasoning"),
      ...reasoningLines,
      "",
      this.theme.fg("dim", "output"),
      ...outputLines,
    ];
  }
}

export function startFusionLivePanel(ctx: ExtensionContext, workers: FusionLiveWorkerState[], title = "LLM Fusion planners"): FusionLivePanelController | undefined {
  if (ctx.mode !== "tui") return undefined;

  let panel: FusionLivePanel | undefined;
  let close: (() => void) | undefined;

  void ctx.ui
    .custom<void>(
      (tui, theme, _keybindings, done) => {
        panel = new FusionLivePanel(tui, theme, workers.map((worker) => ({ ...worker })), title, done);
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
