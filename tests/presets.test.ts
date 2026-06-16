import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { resolveSettings, DEFAULT_PROMPTS, buildDiscoveryPrompt } from "../extensions/pi-fusion/fusion.ts";
import {
  applyFusionPresetSettings,
  deleteFusionPreset,
  findFusionPreset,
  loadFusionPresets,
  saveFusionPreset,
  loadFusionPrompts,
  initializeFusionPrompts,
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

  it("initializes, loads, and overrides custom prompt templates", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-fusion-prompts-"));

    const originalAgentDir = process.env.PI_AGENT_DIR;
    const originalCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_AGENT_DIR = cwd;
    process.env.PI_CODING_AGENT_DIR = cwd;

    try {
      // 1. First run: initialize prompts. Should write DEFAULT_PROMPTS to global fusion.json (cwd/fusion.json)
      await initializeFusionPrompts(cwd);
      const globalFilePath = path.join(cwd, "fusion.json");
      const globalFileRaw = await fs.readFile(globalFilePath, "utf8");
      const globalFile = JSON.parse(globalFileRaw);

      assert.ok(globalFile.prompts);
      assert.equal(globalFile.prompts.discovery, DEFAULT_PROMPTS.discovery);
      assert.equal(globalFile.prompts.rewrite, DEFAULT_PROMPTS.rewrite);
      assert.equal(globalFile.prompts.worker, DEFAULT_PROMPTS.worker);
      assert.equal(globalFile.prompts.actor, DEFAULT_PROMPTS.actor);

      // 2. Load prompts - should fetch from global file
      const loaded1 = await loadFusionPrompts(cwd);
      assert.equal(loaded1.discovery, DEFAULT_PROMPTS.discovery);

      // 3. Edit global file to override one prompt
      globalFile.prompts.discovery = "CUSTOM DISCOVERY: {{task}} in {{cwd}}";
      globalFile.prompts.worker = "CUSTOM WORKER: {{assignedPrompt}}";
      await fs.writeFile(globalFilePath, JSON.stringify(globalFile, null, 2), "utf8");

      const loaded2 = await loadFusionPrompts(cwd);
      assert.equal(loaded2.discovery, "CUSTOM DISCOVERY: {{task}} in {{cwd}}");
      assert.equal(loaded2.rewrite, DEFAULT_PROMPTS.rewrite);

      // Render custom prompt
      const renderedDiscovery = buildDiscoveryPrompt({
        task: "Fix tests",
        recentContext: "",
        cwd: "/src",
        template: loaded2.discovery,
      });
      assert.equal(renderedDiscovery, "CUSTOM DISCOVERY: Fix tests in /src");

      // 4. Create project-local fusion.json with override
      const projectDir = path.join(cwd, ".pi");
      await fs.mkdir(projectDir, { recursive: true });
      const projectFilePath = path.join(projectDir, "fusion.json");
      const projectFile = {
        version: 1,
        prompts: {
          discovery: "PROJECT DISCOVERY: {{task}}",
        },
      };
      await fs.writeFile(projectFilePath, JSON.stringify(projectFile, null, 2), "utf8");

      const loaded3 = await loadFusionPrompts(cwd);
      // Project override wins
      assert.equal(loaded3.discovery, "PROJECT DISCOVERY: {{task}}");
      // Project files only override fields they define; other fields keep global overrides before defaults.
      assert.equal(loaded3.rewrite, DEFAULT_PROMPTS.rewrite);
      assert.equal(loaded3.worker, "CUSTOM WORKER: {{assignedPrompt}}");

      // Render project prompt
      const renderedProjectDiscovery = buildDiscoveryPrompt({
        task: "Fix bug",
        recentContext: "",
        cwd: "/src",
        template: loaded3.discovery,
      });
      assert.equal(renderedProjectDiscovery, "PROJECT DISCOVERY: Fix bug");
    } finally {
      process.env.PI_AGENT_DIR = originalAgentDir;
      process.env.PI_CODING_AGENT_DIR = originalCodingAgentDir;
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("resolves project presets from ancestor project roots", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-fusion-project-root-"));
    const subdir = path.join(cwd, "packages", "app");

    const originalAgentDir = process.env.PI_AGENT_DIR;
    const originalCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_AGENT_DIR = path.join(cwd, "agent");
    process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");

    try {
      await fs.mkdir(path.join(cwd, ".git"), { recursive: true });
      await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
      await fs.mkdir(subdir, { recursive: true });
      await fs.writeFile(path.join(cwd, ".pi", "fusion.json"), JSON.stringify({ presets: { repo: { settings: { workerCount: 3 } } } }), "utf8");

      const preset = findFusionPreset(await loadFusionPresets(subdir), "repo");
      assert.equal(preset?.scope, "project");
      assert.equal(preset?.path, path.join(cwd, ".pi", "fusion.json"));
    } finally {
      process.env.PI_AGENT_DIR = originalAgentDir;
      process.env.PI_CODING_AGENT_DIR = originalCodingAgentDir;
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("ignores malformed preset files instead of crashing", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-fusion-bad-json-"));

    const originalAgentDir = process.env.PI_AGENT_DIR;
    const originalCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_AGENT_DIR = cwd;
    process.env.PI_CODING_AGENT_DIR = cwd;

    try {
      await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
      await fs.writeFile(path.join(cwd, "fusion.json"), JSON.stringify({ presets: { global: { settings: { workerCount: 2 } } } }), "utf8");
      await fs.writeFile(path.join(cwd, ".pi", "fusion.json"), "{ not json", "utf8");

      const presets = await loadFusionPresets(cwd);
      assert.equal(findFusionPreset(presets, "global")?.scope, "global");

      const prompts = await loadFusionPrompts(cwd);
      assert.equal(prompts.discovery, DEFAULT_PROMPTS.discovery);
    } finally {
      process.env.PI_AGENT_DIR = originalAgentDir;
      process.env.PI_CODING_AGENT_DIR = originalCodingAgentDir;
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
