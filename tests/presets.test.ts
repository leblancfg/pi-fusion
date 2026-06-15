import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { resolveSettings } from "../extensions/pi-fusion/fusion.ts";
import {
  applyFusionPresetSettings,
  deleteFusionPreset,
  findFusionPreset,
  loadFusionPresets,
  saveFusionPreset,
} from "../extensions/pi-fusion/presets.ts";

describe("fusion presets", () => {
  it("saves, loads, applies, and deletes project presets", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-fusion-presets-"));
    const name = `project-preset-${Date.now()}`;
    const settings = resolveSettings(
      {},
      {
        enabled: true,
        workerCount: 4,
        workerModel: "google-vertex/gemini-3.5-flash",
        synthesizerModel: "anthropic/claude-sonnet-4-5",
        workerThinking: "off",
        synthesizerThinking: "high",
      },
    );

    const savedPath = await saveFusionPreset(cwd, name, settings, "project", "project-local eval profile");
    assert.equal(savedPath, path.join(cwd, ".pi", "fusion.json"));

    const preset = findFusionPreset(await loadFusionPresets(cwd), name);
    assert.ok(preset);
    assert.equal(preset.scope, "project");
    assert.equal(preset.description, "project-local eval profile");

    const current = resolveSettings({}, { workerCount: 1, workerModel: "openai/gpt-5" });
    preset.settings.discoveryModel = null as unknown as undefined;
    preset.settings.discoveryThinking = null as unknown as undefined;

    const applied = applyFusionPresetSettings(current, preset.name, preset);
    assert.equal(applied.preset, name);
    assert.equal(applied.enabled, true);
    assert.equal(applied.workerCount, 4);
    assert.equal(applied.discoveryModel, undefined);
    assert.equal(applied.discoveryThinking, undefined);
    assert.equal(applied.workerModel, "google-vertex/gemini-3.5-flash");
    assert.equal(applied.synthesizerModel, "anthropic/claude-sonnet-4-5");
    assert.equal(applied.workerThinking, "off");
    assert.equal(applied.synthesizerThinking, "high");

    assert.equal(await deleteFusionPreset(cwd, name, "project"), true);
    assert.equal(findFusionPreset(await loadFusionPresets(cwd), name), undefined);
  });
});
