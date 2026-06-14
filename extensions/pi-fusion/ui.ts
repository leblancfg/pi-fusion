import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, type SelectItem, SelectList, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FusionSettings } from "./fusion.ts";

interface FusionPaneResult {
  action: "save" | "cancel" | "pick-worker-model" | "pick-synthesizer-model";
  settings: FusionSettings;
}

type ModelField = "workerModel" | "synthesizerModel";

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
  private readonly rows = ["enabled", "workers", "workerModel", "synthesizerModel", "save"] as const;

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
      if (row === "workerModel") this.done({ action: "pick-worker-model", settings: this.settings });
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
      this.renderSettingRow("workerModel", "Worker model", formatModelValue(this.settings.workerModel), "enter pick"),
      this.renderSettingRow("synthesizerModel", "Synth model", formatModelValue(this.settings.synthesizerModel), "enter pick"),
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
    } else if (row === "workerModel") {
      this.cycleModel("workerModel", delta);
    } else if (row === "synthesizerModel") {
      this.cycleModel("synthesizerModel", delta);
    }
  }

  private cycleModel(field: ModelField, delta: -1 | 1): void {
    if (this.modelSpecs.length === 0) return;
    const current = normalizeModelChoice(this.settings[field]);
    const index = Math.max(0, this.modelSpecs.indexOf(current));
    const next = this.modelSpecs[(index + delta + this.modelSpecs.length) % this.modelSpecs.length] ?? "current";
    setModelChoice(this.settings, field, next);
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
        overlayOptions: { anchor: "center", width: 78, maxHeight: 12, margin: 2 },
      },
    );

    if (!result || result.action === "cancel") return undefined;
    draft = cloneSettings(result.settings);

    if (result.action === "save") return draft;

    const field = result.action === "pick-worker-model" ? "workerModel" : "synthesizerModel";
    const title = field === "workerModel" ? "Select worker model" : "Select synthesizer model";
    const selected = await pickModel(ctx, title, draft[field], choices);
    if (selected !== null) setModelChoice(draft, field, selected);
  }
}
