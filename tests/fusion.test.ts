import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTOR_PROMPT_MARKER,
  buildActorPrompt,
  buildDiscoveryPrompt,
  buildRewritePrompt,
  buildWorkerPrompt,
  collectRecentConversation,
  consumeNextTurnFusion,
  formatToolEvent,
  fusionStatusGlyph,
  getWorkerLens,
  normalizeWorkerSlots,
  parsePromptVariations,
  resolveSettings,
  resolveWorkerModel,
  resolveWorkerThinking,
  shouldBypassFusion,
  truncateUtf8,
  type WorkerResult,
} from "../extensions/pi-fusion/fusion.ts";

function worker(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    index: 0,
    lens: "mapper",
    ok: true,
    output: "worker output",
    reasoning: "worker reasoning",
    toolContext: "tool context",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    model: "anthropic/claude-sonnet-4-5",
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1 },
    ...overrides,
  };
}

describe("settings", () => {
  it("resolves flags with clamped numeric values", () => {
    const settings = resolveSettings({
      "fusion-workers": "999",
      "fusion-output-bytes": "10",
      "fusion-context-bytes": "-1",
      "fusion-timeout-ms": "abc",
      "fusion-discovery-model": "anthropic/claude-haiku-4-5",
      "fusion-worker-model": "openai/gpt-5",
      "fusion-synthesizer-model": "anthropic/claude-opus-4-5",
      "fusion-discovery-thinking": "low",
      "fusion-worker-thinking": "high",
      "fusion-synthesizer-thinking": "xhigh",
    });

    assert.equal(settings.workerCount, 8);
    assert.equal(settings.workerOutputBytes, 1_000);
    assert.equal(settings.contextBytes, 0);
    assert.equal(settings.timeoutMs, 600_000);
    assert.equal(settings.discoveryModel, "anthropic/claude-haiku-4-5");
    assert.equal(settings.workerModel, "openai/gpt-5");
    assert.equal(settings.synthesizerModel, "anthropic/claude-opus-4-5");
    assert.equal(settings.discoveryThinking, "low");
    assert.equal(settings.workerThinking, "high");
    assert.equal(settings.synthesizerThinking, "xhigh");
  });

  it("normalizes current/default and ignores invalid reasoning levels", () => {
    const settings = resolveSettings({
      "fusion-discovery-thinking": "current",
      "fusion-worker-thinking": "current",
      "fusion-synthesizer-thinking": "default",
    });
    assert.equal(settings.discoveryThinking, undefined);
    assert.equal(settings.workerThinking, undefined);
    assert.equal(settings.synthesizerThinking, undefined);

    const invalid = resolveSettings({
      "fusion-discovery-thinking": "maximum",
      "fusion-worker-thinking": "maximum",
      "fusion-synthesizer-thinking": "wat",
    });
    assert.equal(invalid.discoveryThinking, undefined);
    assert.equal(invalid.workerThinking, undefined);
    assert.equal(invalid.synthesizerThinking, undefined);
  });

  it("keeps --fusion-model as a worker model alias and migrates legacy persisted model", () => {
    assert.equal(resolveSettings({ "fusion-model": "openai/gpt-5" }).workerModel, "openai/gpt-5");
    assert.equal(resolveSettings({}, { model: "anthropic/claude-sonnet-4-5" }).workerModel, "anthropic/claude-sonnet-4-5");
    assert.equal(resolveSettings({ "fusion-worker-model": "current", "fusion-synthesizer-model": "default" }).workerModel, undefined);
  });

  it("is opt-in: off by default, on with --fusion-enabled, forced off by --fusion-disabled", () => {
    assert.equal(resolveSettings({}).enabled, false);
    assert.equal(resolveSettings({ "fusion-enabled": true }).enabled, true);
    assert.equal(resolveSettings({ "fusion-enabled": true, "fusion-disabled": true }).enabled, false);
  });

  it("keeps discovery and rewrite on by default, toggleable via flags and persisted settings", () => {
    const defaults = resolveSettings({});
    assert.equal(defaults.discoveryEnabled, true);
    assert.equal(defaults.rewriteEnabled, true);

    const off = resolveSettings({ "fusion-no-discovery": true, "fusion-no-rewrite": true });
    assert.equal(off.discoveryEnabled, false);
    assert.equal(off.rewriteEnabled, false);

    assert.equal(resolveSettings({ "fusion-no-discovery": true }, { discoveryEnabled: true }).discoveryEnabled, true);
    assert.equal(resolveSettings({}, { rewriteEnabled: false }).rewriteEnabled, false);
  });

  it("lets persisted enabled override startup enable while explicit disable still wins", () => {
    assert.equal(resolveSettings({ "fusion-disabled": true }, { enabled: true, workerCount: 2 }).enabled, false);
    assert.equal(resolveSettings({ "fusion-enabled": true }, { enabled: false }).enabled, false);
    assert.equal(resolveSettings({}, { workerCount: 2 }).workerCount, 2);
  });

  it("normalizes per-worker slots to match the worker count", () => {
    const settings = resolveSettings({ "fusion-workers": "3" }, { workers: [{ model: "openai/gpt-5", thinking: "high" }] });
    assert.equal(settings.workers.length, 3);
    assert.deepEqual(settings.workers[0], { model: "openai/gpt-5", thinking: "high" });
    assert.deepEqual(settings.workers[1], { model: undefined, thinking: undefined });

    assert.equal(normalizeWorkerSlots([{ model: "a", thinking: "low" }], 0).length, 1);
    assert.equal(normalizeWorkerSlots(undefined, 4).length, 4);
  });

  it("consumes enabled state after the next fused turn is armed", () => {
    const settings = resolveSettings({}, { enabled: true });
    assert.equal(consumeNextTurnFusion(settings), true);
    assert.equal(settings.enabled, false);
    assert.equal(consumeNextTurnFusion(settings), false);
  });

  it("formats a compact matching status glyph pair", () => {
    assert.equal(fusionStatusGlyph(false), "φ○");
    assert.equal(fusionStatusGlyph(true), "φ●");
  });

  it("resolves per-worker model/thinking with global then current fallbacks", () => {
    const settings = resolveSettings(
      { "fusion-worker-model": "anthropic/claude-sonnet-4-5", "fusion-worker-thinking": "medium" },
      {
        workerCount: 2,
        workers: [
          { model: "openai/gpt-5", thinking: "high" },
          { model: undefined, thinking: undefined },
        ],
      },
    );
    assert.equal(resolveWorkerModel(settings, 0, "current/model"), "openai/gpt-5");
    assert.equal(resolveWorkerModel(settings, 1, "current/model"), "anthropic/claude-sonnet-4-5");
    assert.equal(resolveWorkerThinking(settings, 0, "off"), "high");
    assert.equal(resolveWorkerThinking(settings, 1, "off"), "medium");
  });
});

describe("bypass", () => {
  it("bypasses commands, queued input, extension input, and already fused prompts", () => {
    assert.equal(
      shouldBypassFusion({ enabled: true, text: "/model", source: "interactive", streamingBehavior: undefined, isIdle: true }),
      "slash command or prompt template",
    );
    assert.equal(
      shouldBypassFusion({ enabled: true, text: "hello", source: "extension", streamingBehavior: undefined, isIdle: true }),
      "extension-injected input",
    );
    assert.equal(
      shouldBypassFusion({ enabled: true, text: "hello", source: "interactive", streamingBehavior: "steer", isIdle: true }),
      "queued steering/follow-up input",
    );
    assert.equal(
      shouldBypassFusion({
        enabled: true,
        text: `${ACTOR_PROMPT_MARKER}\nhello`,
        source: "interactive",
        streamingBehavior: undefined,
        isIdle: true,
      }),
      "already fused",
    );
  });

  it("does not bypass normal idle user input", () => {
    assert.equal(
      shouldBypassFusion({ enabled: true, text: "change the README", source: "interactive", streamingBehavior: undefined, isIdle: true }),
      undefined,
    );
  });

  it("bypasses every input when disabled so toggling off stops the fanout", () => {
    assert.equal(
      shouldBypassFusion({ enabled: false, text: "change the README", source: "interactive", streamingBehavior: undefined, isIdle: true }),
      "disabled",
    );
  });
});

describe("prompts", () => {
  it("builds discovery prompts that focus on context loading, not answering", () => {
    const prompt = buildDiscoveryPrompt({ task: "Fix the bug", recentContext: "", cwd: "/repo" });

    assert.match(prompt, /load context for the rest of the team/i);
    assert.match(prompt, /do not answer/i);
    assert.match(prompt, /not an analysis step/i);
    assert.match(prompt, /opinions or conclusions of any kind/i);
    assert.match(prompt, /stop/i);
    assert.doesNotMatch(prompt, /why this context matters/i);
  });

  it("adapts worker guidance when there is no discovery context", () => {
    const withDiscovery = buildWorkerPrompt({
      task: "Add tests",
      assignedPrompt: "Explore API tests first",
      recentContext: "",
      discoveryContext: "Discovery context",
      cwd: "/repo",
      lens: getWorkerLens(0),
    });
    const withoutDiscovery = buildWorkerPrompt({
      task: "Add tests",
      assignedPrompt: "Explore API tests first",
      recentContext: "",
      discoveryContext: "",
      cwd: "/repo",
      lens: getWorkerLens(0),
    });
    assert.match(withDiscovery, /shared discovery context above is loaded/i);
    assert.doesNotMatch(withoutDiscovery, /shared discovery context above is loaded/i);
    assert.match(withoutDiscovery, /Investigate with read\/search tools/i);
  });

  it("builds read-only numbered worker prompts with discovery context and assigned rewrite", () => {
    const lens = getWorkerLens(0);
    const prompt = buildWorkerPrompt({
      task: "Add tests",
      assignedPrompt: "Explore API tests first",
      recentContext: "Earlier context",
      discoveryContext: "Discovery context",
      cwd: "/repo",
      lens,
    });

    assert.equal(lens.name, "#1");
    assert.match(prompt, /read-only/);
    assert.match(prompt, /do not modify files/);
    assert.match(prompt, /Working directory: \/repo/);
    assert.match(prompt, /Earlier context/);
    assert.ok(prompt.indexOf("## Shared discovery context") < prompt.indexOf("You are worker #1"));
    assert.match(prompt, /Discovery context/);
    assert.match(prompt, /Add tests/);
    assert.match(prompt, /Explore API tests first/);
    assert.doesNotMatch(prompt, /mapper|planner|skeptic/);
  });

  it("builds actor prompt with bounded worker outputs and image warning", () => {
    const prompt = buildActorPrompt({
      originalText: "Implement feature",
      discoveryContext: "Read src/index.ts and found entrypoint",
      promptVariations: ["Explore tests", "Explore API", "Explore docs"],
      workerResults: [worker({ output: "x".repeat(2_000) })],
      workerOutputBytes: 100,
      imageCount: 2,
    });

    assert.match(prompt, new RegExp(ACTOR_PROMPT_MARKER));
    assert.ok(prompt.indexOf("## Shared discovery context") < prompt.indexOf("## Original user request"));
    assert.match(prompt, /Implement feature/);
    assert.match(prompt, /Workers did not see images/);
    assert.match(prompt, /Shared discovery context/);
    assert.match(prompt, /Explore API/);
    assert.match(prompt, /pi-fusion truncated/);
    assert.ok(Buffer.byteLength(prompt, "utf8") < 2_000);
  });
  it("asks the rewrite model for exactly the configured number of prompts", () => {
    const prompt = buildRewritePrompt({ task: "Add tests", recentContext: "", workerCount: 4 });
    assert.match(prompt, /into 4 complementary exploration prompts/);
    assert.match(prompt, /JSON array of 4 strings/);
  });

  it("parses query rewrite JSON and pads/truncates to the worker count", () => {
    assert.deepEqual(parsePromptVariations('["one", "two"]', 3, "fallback"), ["one", "two", "two"]);
    assert.deepEqual(parsePromptVariations('["a","b","c","d"]', 3, "fallback"), ["a", "b", "c"]);
    assert.deepEqual(parsePromptVariations("1. one\n2. two", 2, "fallback"), ["one", "two"]);
    assert.deepEqual(parsePromptVariations("", 2, "fallback"), ["fallback", "fallback"]);
  });
});

describe("tool events", () => {
  it("formats tool calls like the native renderer", () => {
    assert.equal(formatToolEvent("read", { path: "src/index.ts" }), "read src/index.ts");
    assert.equal(formatToolEvent("read", { path: "a.ts", offset: 10, limit: 5 }), "read a.ts:10-14");
    assert.equal(formatToolEvent("grep", { pattern: "Shop", path: "app" }), "grep /Shop/ app");
    assert.equal(formatToolEvent("find", { pattern: "*.ts", path: "src" }), "find *.ts src");
    assert.equal(formatToolEvent("ls", {}), "ls .");
    assert.equal(formatToolEvent("read", { path: "/home/u/x.ts" }, "/home/u"), "read ~/x.ts");
    assert.equal(formatToolEvent("custom", { a: 1 }), 'custom {"a":1}');
  });
});

describe("conversation collection", () => {
  it("collects recent user and assistant messages while skipping prior fusion bundles", () => {
    const entries = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "first" }] } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: `${ACTOR_PROMPT_MARKER}\nold` }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
    ];

    const context = collectRecentConversation(entries, 1_000);

    assert.match(context, /first/);
    assert.match(context, /answer/);
    assert.doesNotMatch(context, /old/);
  });
});

describe("truncateUtf8", () => {
  it("does not split multi-byte characters above the requested byte budget", () => {
    const output = truncateUtf8("界".repeat(100), 17);

    assert.match(output, /pi-fusion truncated/);
    assert.doesNotThrow(() => Buffer.from(output, "utf8").toString("utf8"));
  });
});
