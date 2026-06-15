# pi-fusion presets

Presets are named snapshots of the `/fusion` settings pane. They exist so you can save configurations that match your own model access, budget, and task shape instead of relying on hard-coded defaults that age badly.

A preset can capture:

- whether fusion is enabled;
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

Project presets override global presets with the same name. This mirrors pi's own preset-extension pattern: global defaults first, project-specific settings second.

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

- Missing fields inherit pi-fusion defaults.
- Use `null`, `"current"`, or omit a model field to use the active pi session model.
- Valid reasoning values are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Omit a reasoning field to use the current session setting.
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

Check that the JSON file has a top-level `presets` object and valid JSON syntax. Project presets must be at `.pi/fusion.json` from the repository root you launched pi in.

### I saved a preset but loading it does not change models

The model spec must match a model pi can find, in `provider/model` form. You can set a model back to the current session model from the TUI model picker, or use `null`/omit it in JSON.

### I want to share a preset with a repo

Use `/fusion preset save-project NAME`. Commit `.pi/fusion.json` if the team should share it. Keep personal API-cost choices in `~/.pi/agent/fusion.json` instead.

### I want to remove all fusion presets

Delete `~/.pi/agent/fusion.json` and any project `.pi/fusion.json` files. The extension will recreate files only when you save a preset again.
