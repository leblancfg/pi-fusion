---
layout: default
title: Presets & Prompts
heading: pi-fusion presets & prompts
lead: Save and load settings snapshots or customize all underlying agent prompts.
description: pi-fusion documentation for presets and prompt customization, including JSON file structures, templates, and placeholders.
permalink: /presets/
---

Presets are named snapshots of the `/fusion` settings pane. They exist so you can save configurations that match your own model access, budget, and task shape instead of relying on hard-coded defaults that age badly.

A preset can capture:

- whether fusion is armed for the next eligible turn;
- discovery and rewrite toggles;
- worker count;
- default worker model and reasoning effort;
- per-worker model and reasoning overrides;
- discovery model and reasoning effort;
- synthesizer model and reasoning effort;
- output, context, and timeout budgets.

## Where presets are stored

pi-fusion reads two JSON files:

| Scope   | Path                      | Use it for                                             |
| ------- | ------------------------- | ------------------------------------------------------ |
| Global  | `~/.pi/agent/fusion.json` | Personal presets you want in every repo.               |
| Project | `.pi/fusion.json`         | Repo-specific presets you want to keep with a project. |

Project presets override global presets with the same name. pi-fusion searches upward from the current working directory for an existing `.pi/fusion.json` or `.git` directory, so launching pi from a subdirectory still finds repo-level config. This mirrors pi's own preset-extension pattern: global defaults first, project-specific settings second.

pi-fusion does **not** write to `~/.pi/agent/settings.json`. That file is for pi's main settings and package list. A separate `fusion.json` keeps extension-specific data isolated and easier to delete or share.

## Create a preset from the TUI

Open the settings pane:

```text
/fusion
```

Move to **Presets** and press Enter. From there you can:

- save the current settings as a global preset;
- save the current settings as a project preset;
- load any saved preset;
- delete a saved preset.

Saving from the pane writes exactly what the pane currently shows. If you set workers to `4`, choose `google-vertex/gemini-3.5-flash` as the worker model, and set the synthesizer to `anthropic/claude-sonnet-4-5`, that is what the preset stores. No extra hidden behavior.

## Create and load presets from slash commands

```text
/fusion preset list
/fusion preset save cheap-planners
/fusion preset save-project repo-review
/fusion preset cheap-planners
```

Command behavior:

| Command                            | Effect                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| `/fusion preset list`              | Lists saved presets and their scope.                          |
| `/fusion preset save NAME`         | Saves the current settings to `~/.pi/agent/fusion.json`.      |
| `/fusion preset save-project NAME` | Saves the current settings to `.pi/fusion.json`.              |
| `/fusion preset NAME`              | Loads `NAME` from project presets first, then global presets. |

## Load a preset at startup

```bash
pi --fusion-preset cheap-planners --fusion-enabled
```

`--fusion-preset` loads the named settings snapshot during `session_start`. It does not invent a preset if none exists. If the name is wrong, pi-fusion reports the known preset names in the TUI notification area.

## JSON format

The file is intentionally plain JSON:

```json
{
  "version": 1,
  "presets": {
    "cheap-planners": {
      "description": "Gemini Flash workers feeding the current actor model",
      "settings": {
        "enabled": true,
        "discoveryEnabled": true,
        "rewriteEnabled": true,
        "workerCount": 3,
        "workerModel": "google-vertex/gemini-3.5-flash",
        "workerThinking": "off",
        "plannerToolMode": "all",
        "synthesizerModel": null,
        "synthesizerThinking": "current",
        "workerOutputBytes": 12000,
        "contextBytes": 16000,
        "timeoutMs": 600000,
        "workers": []
      }
    }
  }
}
```

Notes:

- `enabled: true` arms fusion for one eligible turn when the preset is loaded. After the fused turn starts, pi-fusion writes the state back to off.
- Missing fields inherit pi-fusion defaults.
- Use `null`, `"current"`, or omit a model field to use the active pi session model.
- Valid reasoning values are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Omit a reasoning field to use the current session setting.
- `plannerToolMode` controls discovery and worker tool access. Use `all` for normal tool access or `read-only` for the original `read`/`grep`/`find`/`ls`-only mode. Missing fields backfill to `all`.
- `workers` is optional. If present, each entry can override the default worker model or reasoning for a specific worker slot.

## Example: cheap planners, premium actor

This is the configuration I expect many people to try first:

```json
{
  "version": 1,
  "presets": {
    "cheap-planners": {
      "description": "Fast worker fanout, current model as actor",
      "settings": {
        "enabled": true,
        "discoveryEnabled": true,
        "rewriteEnabled": true,
        "workerCount": 3,
        "discoveryModel": "google-vertex/gemini-3.5-flash",
        "discoveryThinking": "off",
        "workerModel": "google-vertex/gemini-3.5-flash",
        "workerThinking": "off",
        "plannerToolMode": "all",
        "synthesizerModel": null,
        "synthesizerThinking": null,
        "workerOutputBytes": 12000,
        "contextBytes": 16000,
        "timeoutMs": 600000
      }
    }
  }
}
```

This keeps the expensive model in the actor seat and uses cheaper planners to reduce blind spots. It is not universally better. It is a good starting point when you want to test whether parallel planning buys more than it costs for your own workload.

## Example: four specialist workers

```json
{
  "version": 1,
  "presets": {
    "review-panel": {
      "description": "Mixed worker panel for code review",
      "settings": {
        "enabled": true,
        "workerCount": 4,
        "workerModel": "google-vertex/gemini-3.5-flash",
        "workerThinking": "off",
        "workers": [
          { "model": "google-vertex/gemini-3.5-flash", "thinking": "off" },
          { "model": "anthropic/claude-haiku-4-5", "thinking": "low" },
          { "model": null, "thinking": "medium" },
          { "model": "openai/gpt-5.2-codex", "thinking": "low" }
        ]
      }
    }
  }
}
```

Each worker slot inherits `workerModel` and `workerThinking` unless it has an explicit override.

## Troubleshooting

### My preset does not show up

Check that the JSON file has a top-level `presets` object and valid JSON syntax. Malformed `fusion.json` files are ignored instead of crashing the extension. Project presets live at `.pi/fusion.json`; pi-fusion searches upward from the directory where pi is running.

### I saved a preset but loading it does not change models

The model spec must match a model pi can find, in `provider/model` form. You can set a model back to the current session model from the TUI model picker, or use `null`/omit it in JSON.

### I want to share a preset with a repo

Use `/fusion preset save-project NAME`. Commit `.pi/fusion.json` if the team should share it. Keep personal API-cost choices in `~/.pi/agent/fusion.json` instead.

### I want to remove all fusion presets

Delete `~/.pi/agent/fusion.json` and any project `.pi/fusion.json` files. The extension will recreate files only when you save a preset again.

---

## Prompt Customization

You can fully customize all the prompts used by `pi-fusion`. On first run, default prompts are automatically written to your global `fusion.json` file. You can see and edit them there, or override them on a per-project basis.

### Where prompts are stored

`pi-fusion` reads prompts from two locations:

| Scope   | Path                      | Use it for                                          |
| ------- | ------------------------- | --------------------------------------------------- |
| Global  | `~/.pi/agent/fusion.json` | Default templates used across all projects.         |
| Project | `.pi/fusion.json`         | Project-specific templates to share with your team. |

Project-level prompts override global prompts per field. pi-fusion searches upward from the current working directory for an existing `.pi/fusion.json` or `.git` directory, so launching pi from a subdirectory still finds repo-level config. For example, a project file can override only `worker` while keeping your global `discovery`, `rewrite`, and `actor` templates.

### JSON format

Add a `"prompts"` section at the top level of your `fusion.json`:

```json
{
  "version": 1,
  "prompts": {
    "discovery": "...",
    "rewrite": "...",
    "worker": "...",
    "actor": "..."
  },
  "presets": {
    "cheap-planners": {
      "description": "Fast worker fanout, current model as actor",
      "settings": {
        ...
      }
    }
  }
}
```

### Available Prompts & Placeholders

Each prompt supports simple `{{placeholder}}` templating. You can rearrange, rewrite, or completely re-format the instruction text, as long as you preserve the template tags you want to substitute.

#### 1. Discovery Prompt (`prompts.discovery`)

This prompt guides the discovery agent to explore your codebase.

- **Placeholders:**
  - `{{cwd}}`: Working directory of your project.
  - `{{task}}`: Your original prompt.
  - `{{recentContext}}`: Pre-formatted recent conversation history.
  - `{{toolGuidance}}`: Pre-formatted guidance for the selected planner tool mode.

#### 2. Prompt Rewrite (`prompts.rewrite`)

This prompt is used to ask the rewrite model to generate worker prompts.

- **Placeholders:**
  - `{{workerCount}}`: The number of parallel workers.
  - `{{task}}`: Your original prompt.
  - `{{recentContext}}`: Pre-formatted recent conversation history.

#### 3. Worker Prompt (`prompts.worker`)

This prompt runs on each parallel worker.

- **Placeholders:**
  - `{{cwd}}`: Working directory of your project.
  - `{{task}}`: Your original prompt.
  - `{{assignedPrompt}}`: The rewritten prompt variation generated for this worker.
  - `{{discoveryContext}}`: Context loaded and handed off by the discovery agent.
  - `{{workerName}}`: Slot index/name (e.g. `#1`, `#2`).
  - `{{discoveryGuidance}}`: Pre-formatted guidance on how to use the discovery context.
  - `{{toolGuidance}}`: Pre-formatted guidance for the selected planner tool mode.
  - `{{recentContext}}`: Pre-formatted recent conversation history.

#### 4. Actor/Synthesizer Prompt (`prompts.actor`)

This prompt formats the final planning bundle injected into the main actor's turn.

- **Placeholders:**
  - `{{task}}`: Your original prompt.
  - `{{discoveryContext}}`: Context loaded by the discovery agent.
  - `{{variations}}`: List of worker prompt variations.
  - `{{workerOutputs}}`: Outputs and plans produced by each worker.
  - `{{imageNote}}`: A note telling the actor that workers did not see attached images (if any).

> 💡 **Important:** The actor prompt template should contain `<!-- pi-fusion:actor-prompt -->` so that subsequent conversation turns know a fused turn has finished and bypass fusion automatically. If a custom actor prompt omits it, pi-fusion prepends the marker defensively.
