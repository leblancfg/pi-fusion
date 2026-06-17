// Headless smoke test for the published dist entrypoint.
import piFusion from "../dist/extensions/pi-fusion/index.js";

const flags = [];
const commands = [];
const events = [];

const stub = {
  registerFlag: (name) => flags.push(name),
  registerCommand: (name) => commands.push(name),
  registerMessageRenderer: () => {},
  on: (event) => events.push(event),
  getFlag: () => undefined,
  getThinkingLevel: () => "off",
  setThinkingLevel: () => {},
  setModel: async () => true,
  appendEntry: () => {},
};

piFusion(stub);

const requiredFlags = ["fusion-disabled", "fusion-workers", "fusion-worker-model", "fusion-synthesizer-model"];
const requiredCommands = ["fusion"];
const requiredEvents = ["session_start", "input", "before_agent_start"];

for (const flag of requiredFlags) {
  if (!flags.includes(flag)) throw new Error(`dist smoke: missing flag --${flag}`);
}
for (const command of requiredCommands) {
  if (!commands.includes(command)) throw new Error(`dist smoke: missing command /${command}`);
}
for (const event of requiredEvents) {
  if (!events.includes(event)) throw new Error(`dist smoke: missing handler for ${event}`);
}

console.log(`dist smoke ok: ${flags.length} flags, ${commands.length} command(s), events [${events.join(", ")}]`);
