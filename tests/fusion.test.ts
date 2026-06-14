import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTOR_PROMPT_MARKER,
  buildActorPrompt,
  buildWorkerPrompt,
  collectRecentConversation,
  getWorkerLens,
  resolveSettings,
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
      "fusion-worker-model": "openai/gpt-5",
      "fusion-synthesizer-model": "anthropic/claude-opus-4-5",
      "fusion-worker-thinking": "high",
      "fusion-synthesizer-thinking": "xhigh",
    });

    assert.equal(settings.workerCount, 8);
    assert.equal(settings.workerOutputBytes, 1_000);
    assert.equal(settings.contextBytes, 0);
    assert.equal(settings.timeoutMs, 600_000);
    assert.equal(settings.workerModel, "openai/gpt-5");
    assert.equal(settings.synthesizerModel, "anthropic/claude-opus-4-5");
    assert.equal(settings.workerThinking, "high");
    assert.equal(settings.synthesizerThinking, "xhigh");
  });

  it("normalizes current/default and ignores invalid reasoning levels", () => {
    const settings = resolveSettings({
      "fusion-worker-thinking": "current",
      "fusion-synthesizer-thinking": "default",
    });
    assert.equal(settings.workerThinking, undefined);
    assert.equal(settings.synthesizerThinking, undefined);

    const invalid = resolveSettings({ "fusion-worker-thinking": "maximum", "fusion-synthesizer-thinking": "wat" });
    assert.equal(invalid.workerThinking, undefined);
    assert.equal(invalid.synthesizerThinking, undefined);
  });

  it("keeps --fusion-model as a worker model alias and migrates legacy persisted model", () => {
    assert.equal(resolveSettings({ "fusion-model": "openai/gpt-5" }).workerModel, "openai/gpt-5");
    assert.equal(resolveSettings({}, { model: "anthropic/claude-sonnet-4-5" }).workerModel, "anthropic/claude-sonnet-4-5");
    assert.equal(resolveSettings({ "fusion-worker-model": "current", "fusion-synthesizer-model": "default" }).workerModel, undefined);
  });

  it("lets persisted enabled override the startup disable flag", () => {
    const settings = resolveSettings({ "fusion-disabled": true }, { enabled: true, workerCount: 2 });

    assert.equal(settings.enabled, true);
    assert.equal(settings.workerCount, 2);
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
});

describe("prompts", () => {
  it("builds read-only worker prompts with task, context, cwd, and lens", () => {
    const lens = getWorkerLens(0);
    const prompt = buildWorkerPrompt({
      task: "Add tests",
      recentContext: "Earlier context",
      cwd: "/repo",
      workerIndex: 0,
      workerCount: 3,
      lens,
    });

    assert.match(prompt, /read-only/);
    assert.match(prompt, /do not modify files/);
    assert.match(prompt, /Working directory: \/repo/);
    assert.match(prompt, /Earlier context/);
    assert.match(prompt, /Add tests/);
    assert.match(prompt, /Planning lens: mapper/);
  });

  it("builds actor prompt with bounded worker outputs and image warning", () => {
    const prompt = buildActorPrompt({
      originalText: "Implement feature",
      workerResults: [worker({ output: "x".repeat(2_000) })],
      workerOutputBytes: 100,
      imageCount: 2,
    });

    assert.match(prompt, new RegExp(ACTOR_PROMPT_MARKER));
    assert.match(prompt, /Implement feature/);
    assert.match(prompt, /Workers did not see images/);
    assert.match(prompt, /pi-fusion truncated/);
    assert.ok(Buffer.byteLength(prompt, "utf8") < 2_000);
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
    const output = truncateUtf8("😀".repeat(100), 17);

    assert.match(output, /pi-fusion truncated/);
    assert.doesNotThrow(() => Buffer.from(output, "utf8").toString("utf8"));
  });
});
