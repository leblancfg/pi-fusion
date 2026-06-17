---
layout: default
title: pi-fusion
heading: pi-fusion
lead: A compound-AI planning pass for pi. Several model calls explore your task in parallel, then merge into one synthesis turn.
description: pi-fusion is a compound AI planning fanout for pi: parallel model calls, optional discovery, prompt rewrites, configurable planner tools, and one final actor response.
---

<div class="install" aria-label="Installation command">
  <pre><code>pi install npm:@leblancfg/pi-fusion</code></pre>
</div>

<figure class="diagram">
  <img src="{{ '/assets/fusion-map.svg' | relative_url }}" alt="Prompt flows into optional discovery and rewrite, then planner workers, then one pi actor turn" />
  <figcaption class="caption">Local pi subprocesses, not OpenRouter's hosted Fusion route. Discovery and rewrite are optional.</figcaption>
</figure>

<p class="section-label">How it works</p>

<section class="grid" aria-label="How it works">
  <article class="card">
    <h2>What it does</h2>
    <p>Workers plan in parallel with configurable tool access, then their notes are injected into the synthesis turn's system prompt for that turn only.</p>
  </article>
  <article class="card">
    <h2>Why bother</h2>
    <p>A cheap test-time compute fanout can catch missed files, alternate fixes, or risks before the synthesis turn starts editing.</p>
  </article>
  <article class="card">
    <h2>When to use it</h2>
    <p>Fuzzy bugs, unfamiliar code, refactors, reviews. Turn it off for tiny edits where latency costs more than the plan.</p>
  </article>
</section>

<p class="section-label">Get started</p>

<section class="grid" aria-label="Get started">
  <article class="card">
    <h2>Open settings</h2>
    <pre><code>/fusion</code></pre>
    <p>Set worker count, choose planner tool access, pick models, and save/load your own presets from the TUI pane.</p>
  </article>
  <article class="card">
    <h2>Run locally</h2>
    <pre><code>pi -e ./extensions/pi-fusion/index.ts</code></pre>
    <p>Test a checkout before installing it as a package.</p>
  </article>
  <article class="card">
    <h2>Read the preset docs</h2>
    <pre><code>/fusion preset list</code></pre>
    <p>Presets are rendered as a local docs page, not a link out to GitHub. <a href="{{ '/presets/' | relative_url }}">Read them here.</a></p>
  </article>
</section>
