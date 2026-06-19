import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SessionManager, convertToLlm } from "@earendil-works/pi-coding-agent";
import {
  SYNTHESIS_PROMPT_MARKER,
  LEGACY_SYNTHESIS_PROMPT_MARKER,
  buildFusionArchive,
  buildFusionArchiveEntries,
  buildSynthesisPrompt,
  buildDiscoveryPrompt,
  buildFusionTraceMessage,
  buildRewritePrompt,
  buildWorkerPrompt,
  chunkUtf8,
  collectRecentConversation,
  consumeNextTurnFusion,
  createFusionRunId,
  formatFusionTraceDetails,
  formatToolEvent,
  fusionStatusGlyph,
  getWorkerLens,
  listFusionArchiveRuns,
  normalizeWorkerSlots,
  parsePromptVariations,
  reconstructFusionArchive,
  resolveSettings,
  resolveWorkerModel,
  resolveWorkerThinking,
  shouldBypassFusion,
  truncateUtf8,
  FUSION_ARCHIVE_ENTRY_TYPE,
  FUSION_TRACE_MESSAGE_TYPE,
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
      "fusion-synthesis-model": "anthropic/claude-opus-4-5",
      "fusion-discovery-thinking": "low",
      "fusion-worker-thinking": "high",
      "fusion-synthesis-thinking": "xhigh",
    });

    assert.equal(settings.workerCount, 8);
    assert.equal(settings.workerOutputBytes, 1_000);
    assert.equal(settings.contextBytes, 0);
    assert.equal(settings.timeoutMs, 600_000);
    assert.equal(settings.discoveryModel, "anthropic/claude-haiku-4-5");
    assert.equal(settings.workerModel, "openai/gpt-5");
    assert.equal(settings.synthesisModel, "anthropic/claude-opus-4-5");
    assert.equal(settings.discoveryThinking, "low");
    assert.equal(settings.workerThinking, "high");
    assert.equal(settings.synthesisThinking, "xhigh");
  });

  it("normalizes current/default and ignores invalid reasoning levels", () => {
    const settings = resolveSettings({
      "fusion-discovery-thinking": "current",
      "fusion-worker-thinking": "current",
      "fusion-synthesis-thinking": "default",
    });
    assert.equal(settings.discoveryThinking, undefined);
    assert.equal(settings.workerThinking, undefined);
    assert.equal(settings.synthesisThinking, undefined);

    const invalid = resolveSettings({
      "fusion-discovery-thinking": "maximum",
      "fusion-worker-thinking": "maximum",
      "fusion-synthesis-thinking": "wat",
    });
    assert.equal(invalid.discoveryThinking, undefined);
    assert.equal(invalid.workerThinking, undefined);
    assert.equal(invalid.synthesisThinking, undefined);
  });

  it("keeps --fusion-model as a worker model alias and migrates legacy persisted model", () => {
    assert.equal(resolveSettings({ "fusion-model": "openai/gpt-5" }).workerModel, "openai/gpt-5");
    assert.equal(resolveSettings({}, { model: "anthropic/claude-sonnet-4-5" }).workerModel, "anthropic/claude-sonnet-4-5");
    assert.equal(resolveSettings({ "fusion-worker-model": "current", "fusion-synthesis-model": "default" }).workerModel, undefined);
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

  it("defaults planner subprocesses to all tools with a read-only opt-out", () => {
    assert.equal(resolveSettings({}).plannerToolMode, "all");
    assert.equal(resolveSettings({ "fusion-planner-tools": "read-only" }).plannerToolMode, "read-only");
    assert.equal(resolveSettings({ "fusion-planner-tools": "readonly" }).plannerToolMode, "read-only");
    assert.equal(resolveSettings({ "fusion-planner-tools": "all" }, { plannerToolMode: "read-only" }).plannerToolMode, "all");
    assert.equal(resolveSettings({ "fusion-planner-tools": "wat" }, { plannerToolMode: "read-only" }).plannerToolMode, "read-only");
    assert.equal(resolveSettings({}, { plannerToolMode: "wat" as never }).plannerToolMode, "all");
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
    assert.equal(fusionStatusGlyph(false), "∪\u0338");
    assert.equal(fusionStatusGlyph(true), "∪");
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
        text: `${SYNTHESIS_PROMPT_MARKER}\nhello`,
        source: "interactive",
        streamingBehavior: undefined,
        isIdle: true,
      }),
      "already fused",
    );
    assert.equal(
      shouldBypassFusion({
        enabled: true,
        text: `${LEGACY_SYNTHESIS_PROMPT_MARKER}\nhello`,
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
    const readOnlyWithoutDiscovery = buildWorkerPrompt({
      task: "Add tests",
      assignedPrompt: "Explore API tests first",
      recentContext: "",
      discoveryContext: "",
      cwd: "/repo",
      lens: getWorkerLens(0),
      plannerToolMode: "read-only",
    });
    assert.match(withDiscovery, /shared discovery context above is loaded/i);
    assert.doesNotMatch(withoutDiscovery, /shared discovery context above is loaded/i);
    assert.match(withoutDiscovery, /Investigate with available tools/i);
    assert.match(readOnlyWithoutDiscovery, /Investigate with read\/search tools/i);
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
      plannerToolMode: "read-only",
    });

    assert.equal(lens.name, "#1");
    assert.match(prompt, /read-only/);
    assert.match(prompt, /do not modify files/i);
    assert.match(prompt, /Working directory: \/repo/);
    assert.match(prompt, /Earlier context/);
    assert.ok(prompt.indexOf("## Shared discovery context") < prompt.indexOf("You are worker #1"));
    assert.match(prompt, /Discovery context/);
    assert.match(prompt, /Add tests/);
    assert.match(prompt, /Explore API tests first/);
    assert.doesNotMatch(prompt, /mapper|planner|skeptic/);
  });

  it("builds synthesis prompt with bounded worker outputs and image warning", () => {
    const prompt = buildSynthesisPrompt({
      originalText: "Implement feature",
      discoveryContext: "Read src/index.ts and found entrypoint",
      promptVariations: ["Explore tests", "Explore API", "Explore docs"],
      workerResults: [worker({ output: "x".repeat(2_000) })],
      workerOutputBytes: 100,
      imageCount: 2,
    });

    assert.match(prompt, new RegExp(SYNTHESIS_PROMPT_MARKER));
    assert.ok(prompt.indexOf("## Shared discovery context") < prompt.indexOf("## Original user request"));
    assert.match(prompt, /Implement feature/);
    assert.match(prompt, /Workers did not see images/);
    assert.match(prompt, /Shared discovery context/);
    assert.match(prompt, /Explore API/);
    assert.match(prompt, /pi-fusion truncated/);
    assert.ok(Buffer.byteLength(prompt, "utf8") < 2_000);
  });
  it("preserves the fusion marker when synthesis prompts are customized", () => {
    const prompt = buildSynthesisPrompt({
      originalText: "Implement feature",
      discoveryContext: "",
      promptVariations: [],
      workerResults: [worker()],
      workerOutputBytes: 100,
      imageCount: 0,
      template: "Custom synthesis prompt for {{task}}\n\n{{workerOutputs}}",
    });

    assert.match(prompt, new RegExp(SYNTHESIS_PROMPT_MARKER));
    assert.ok(prompt.indexOf(SYNTHESIS_PROMPT_MARKER) < prompt.indexOf("Custom synthesis prompt"));
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

describe("fusion trace", () => {
  it("puts a bounded handoff in content and a runId pointer to the archive", () => {
    const message = buildFusionTraceMessage({
      task: "Implement feature",
      discoveryEnabled: true,
      rewriteEnabled: true,
      promptVariations: ["Explore API", "Explore tests"],
      discoveryResult: worker({ lens: "discovery", output: "loaded src/index.ts" }),
      rewriteResult: worker({ lens: "rewrite", output: '["Explore API", "Explore tests"]' }),
      workerResults: [worker({ index: 0, lens: "#1", output: "plan A" }), worker({ index: 1, lens: "#2", output: "plan B" })],
      runId: "fusion-20260617-000000-abc123",
      archiveChunks: 1,
      archiveBytes: 4_096,
    });

    assert.equal(message.customType, FUSION_TRACE_MESSAGE_TYPE);
    assert.equal(message.display, true);
    // The model-visible content carries the headline, an archive pointer, and bounded conclusions.
    assert.match(message.content, /pi-fusion transcript/);
    assert.match(message.content, /plan A/);
    assert.match(message.content, /\/fusion-transcript fusion-20260617-000000-abc123/);
    assert.equal(message.details.runId, "fusion-20260617-000000-abc123");
    assert.equal(message.details.workers.length, 2);

    const expanded = formatFusionTraceDetails(message.details);
    assert.match(expanded, /Full untruncated transcript archived/);
    assert.match(expanded, /Explore API/);
    assert.match(expanded, /plan A/);
  });

  it("bounds the in-context handoff and detail previews regardless of worker size", () => {
    const message = buildFusionTraceMessage({
      task: "x".repeat(10_000),
      discoveryEnabled: false,
      rewriteEnabled: false,
      promptVariations: ["p".repeat(10_000)],
      workerResults: [worker({ output: "o".repeat(40_000), reasoning: "r".repeat(20_000), toolContext: "t".repeat(40_000) })],
      resumeContextBytes: 8_000,
    });

    // content is the LLM-visible handoff: bounded by resumeContextBytes (+ headline/pointer).
    assert.ok(Buffer.byteLength(message.content, "utf8") < 9_000);
    assert.match(message.content, /pi-fusion truncated/);

    // details are previews only: small and never carry the full transcript.
    const expanded = formatFusionTraceDetails(message.details);
    assert.ok(Buffer.byteLength(expanded, "utf8") < 12_000);
  });
});

describe("fusion archive", () => {
  it("chunks utf8 byte-exactly and reversibly", () => {
    const text = "é".repeat(5_000) + "\nplan details\n" + "中".repeat(5_000);
    const chunks = chunkUtf8(text, 4_000);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk, "utf8") <= 4_000);
    assert.equal(chunks.join(""), text);
  });

  it("archives the full untruncated transcript and reconstructs it byte-exactly", () => {
    const runId = "fusion-20260617-000000-deadbe";
    const input = {
      runId,
      createdAt: "2026-06-17T00:00:00.000Z",
      task: "Implement feature",
      discoveryEnabled: true,
      rewriteEnabled: true,
      promptVariations: ["Explore API", "Explore tests"],
      discoveryResult: worker({ lens: "discovery", output: "loaded src/index.ts" }),
      rewriteResult: worker({ lens: "rewrite", output: '["Explore API", "Explore tests"]' }),
      workerResults: [
        worker({ index: 0, lens: "#1", output: "FULL_WORKER_OUTPUT_" + "z".repeat(60_000), toolContext: "deep tool trace" }),
        worker({ index: 1, lens: "#2", output: "plan B" }),
      ],
    };

    const transcript = buildFusionArchive(input);
    assert.match(transcript, /FULL_WORKER_OUTPUT_/);
    assert.match(transcript, /deep tool trace/);
    // No semantic truncation in the archive.
    assert.doesNotMatch(transcript, /pi-fusion truncated/);

    const { manifest, chunks } = buildFusionArchiveEntries(input);
    assert.equal(manifest.runId, runId);
    assert.equal(manifest.workerCount, 2);
    assert.ok(chunks.length > 1);

    const entries = [
      { type: "custom", customType: FUSION_ARCHIVE_ENTRY_TYPE, data: manifest },
      ...chunks.map((data) => ({ type: "custom", customType: FUSION_ARCHIVE_ENTRY_TYPE, data })),
    ];
    const restored = reconstructFusionArchive(entries);
    assert.ok(restored);
    assert.equal(restored.content, transcript);
    assert.equal(restored.manifest.runId, runId);
  });

  it("selects the requested run and lists archived runs", () => {
    const a = buildFusionArchiveEntries({
      runId: "fusion-A",
      task: "task A",
      discoveryEnabled: false,
      rewriteEnabled: false,
      promptVariations: [],
      workerResults: [worker({ output: "OUTPUT_A" })],
    });
    const b = buildFusionArchiveEntries({
      runId: "fusion-B",
      task: "task B",
      discoveryEnabled: false,
      rewriteEnabled: false,
      promptVariations: [],
      workerResults: [worker({ output: "OUTPUT_B" })],
    });
    const entries = [
      { type: "custom", customType: FUSION_ARCHIVE_ENTRY_TYPE, data: a.manifest },
      ...a.chunks.map((data) => ({ type: "custom", customType: FUSION_ARCHIVE_ENTRY_TYPE, data })),
      { type: "custom", customType: FUSION_ARCHIVE_ENTRY_TYPE, data: b.manifest },
      ...b.chunks.map((data) => ({ type: "custom", customType: FUSION_ARCHIVE_ENTRY_TYPE, data })),
    ];

    assert.match(reconstructFusionArchive(entries, "fusion-A")!.content, /OUTPUT_A/);
    assert.match(reconstructFusionArchive(entries, "fusion-B")!.content, /OUTPUT_B/);
    // Default picks the most recent run.
    assert.match(reconstructFusionArchive(entries)!.content, /OUTPUT_B/);
    assert.equal(reconstructFusionArchive(entries, "missing"), undefined);
    assert.deepEqual(
      listFusionArchiveRuns(entries).map((m) => m.runId),
      ["fusion-A", "fusion-B"],
    );
  });

  it("generates sortable, unique run ids", () => {
    const id = createFusionRunId(new Date("2026-06-17T15:30:12.000Z"));
    assert.match(id, /^fusion-20260617-153012-[0-9a-z]{6}$/);
    assert.notEqual(createFusionRunId(), createFusionRunId());
  });
});

describe("session persistence (end-to-end)", () => {
  // Drives a real on-disk pi session through a simulated fusion turn, then
  // reloads it from JSONL and asserts the resume/audit contract:
  //   - full sub-agent output is recoverable from the session file
  //   - only the bounded handoff reaches the LLM on subsequent turns
  it("archives full worker output out of context while exposing a bounded handoff", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fusion-session-"));
    const sm = SessionManager.create(dir, dir);
    const sessionFile = sm.getSessionFile();
    assert.ok(sessionFile);

    const runId = createFusionRunId();
    const workerResults = [
      worker({ index: 0, lens: "#1", output: "SECRET_WORKER_OUTPUT plan A details", toolContext: "ARCHIVE_ONLY_TOOL_TRACE" }),
      worker({ index: 1, lens: "#2", output: "plan B details" }),
    ];

    // 1. The user prompt that armed fusion.
    sm.appendMessage({ role: "user", content: [{ type: "text", text: "Implement feature X" }], timestamp: Date.now() });

    // 2. Persist the full archive as non-context custom entries (as runFusion does).
    const archive = buildFusionArchiveEntries({
      runId,
      task: "Implement feature X",
      discoveryEnabled: true,
      rewriteEnabled: true,
      promptVariations: ["Explore API", "Explore tests"],
      discoveryResult: worker({ lens: "discovery", output: "DISCOVERY_ARCHIVE_ONLY context" }),
      workerResults,
    });
    sm.appendCustomEntry(FUSION_ARCHIVE_ENTRY_TYPE, archive.manifest);
    for (const chunk of archive.chunks) sm.appendCustomEntry(FUSION_ARCHIVE_ENTRY_TYPE, chunk);

    // 3. The in-context handoff custom_message (as before_agent_start returns).
    const trace = buildFusionTraceMessage({
      task: "Implement feature X",
      discoveryEnabled: true,
      rewriteEnabled: true,
      promptVariations: ["Explore API", "Explore tests"],
      workerResults,
      runId,
      archiveChunks: archive.chunks.length,
      archiveBytes: archive.manifest.bytes,
      resumeContextBytes: 8_000,
    });
    sm.appendCustomMessageEntry(trace.customType, trace.content, trace.display, trace.details);

    // 4. The synthesis answer.
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Here is the synthesized plan." }],
      api: "anthropic-messages",
      provider: "test",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    // Reload the session from disk, exactly like resuming.
    const reopened = SessionManager.open(sessionFile!);
    const entries = reopened.getEntries();

    // The full transcript is recoverable from the saved file.
    const restored = reconstructFusionArchive(entries, runId);
    assert.ok(restored, "archive should be reconstructable from the reloaded session");
    assert.match(restored.content, /SECRET_WORKER_OUTPUT/);
    assert.match(restored.content, /ARCHIVE_ONLY_TOOL_TRACE/);
    assert.match(restored.content, /DISCOVERY_ARCHIVE_ONLY/);

    // What a resumed/subsequent model turn actually sees.
    const llm = convertToLlm(reopened.buildSessionContext().messages);
    const llmText = JSON.stringify(llm);
    assert.match(llmText, /Implement feature X/);
    assert.match(llmText, /Worker conclusions/);
    assert.match(llmText, new RegExp(`/fusion-transcript ${runId}`));
    // Raw archive-only content must NOT leak into LLM context.
    assert.doesNotMatch(llmText, /ARCHIVE_ONLY_TOOL_TRACE/);
    assert.doesNotMatch(llmText, /DISCOVERY_ARCHIVE_ONLY/);

    // Archive entries live in the tree but are skipped by context building.
    const archiveEntries = entries.filter(
      (e) =>
        (e as { type?: string; customType?: string }).type === "custom" && (e as { customType?: string }).customType === FUSION_ARCHIVE_ENTRY_TYPE,
    );
    assert.ok(archiveEntries.length >= 2);
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
      { type: "message", message: { role: "user", content: [{ type: "text", text: `${SYNTHESIS_PROMPT_MARKER}\nold` }] } },
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
