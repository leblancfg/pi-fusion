// Headless smoke test: load the extension with a stub ExtensionAPI and assert
// it wires up the expected flags, command, and event handlers. Catches
// import-time and registration regressions without needing the pi binary or an
// API key, so it can run in CI.
import piFusion from "../extensions/pi-fusion/index.ts";

const flags: string[] = [];
const commands: string[] = [];
const events: string[] = [];

const stub = {
  registerFlag: (name: string) => flags.push(name),
  registerCommand: (name: string) => commands.push(name),
  on: (event: string) => events.push(event),
  getFlag: () => undefined,
  getThinkingLevel: () => "off",
  setThinkingLevel: () => {},
  setModel: async () => true,
  appendEntry: () => {},
};

piFusion(stub as unknown as Parameters<typeof piFusion>[0]);

const requiredFlags = ["fusion-disabled", "fusion-workers", "fusion-worker-model", "fusion-synthesizer-model"];
const requiredCommands = ["fusion"];
const requiredEvents = ["session_start", "input", "before_agent_start"];

for (const flag of requiredFlags) {
  if (!flags.includes(flag)) throw new Error(`smoke: missing flag --${flag}`);
}
for (const command of requiredCommands) {
  if (!commands.includes(command)) throw new Error(`smoke: missing command /${command}`);
}
for (const event of requiredEvents) {
  if (!events.includes(event)) throw new Error(`smoke: missing handler for ${event}`);
}

console.log(`smoke ok: ${flags.length} flags, ${commands.length} command(s), events [${events.join(", ")}]`);
