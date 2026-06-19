<p class="section-label">Installation</p>
<div class="install" aria-label="Installation command">
  <pre><code>pi install npm:@leblancfg/pi-fusion</code></pre>
</div>

<figure class="diagram">
  <img src="{{ '/assets/fusion-map.svg' | relative_url }}" alt="Prompt flows into optional discovery and rewrite, then planner workers, then into a final synthesis turn." />
  <figcaption class="caption">Local pi subprocesses, not OpenRouter's hosted Fusion route. Discovery and rewrite are optional.</figcaption>
</figure>


<section class="grid" aria-label="How it works">
  <article class="card">
    <h2>What it does</h2>
    <p>Workers plan in parallel with configurable tool access, then their notes are injected into the synthesis prompt. The full sub-agent transcripts are archived in a single <a href="https://pi.dev/docs/latest/session-format#tree-structure">pi session file</a> &mdash; auditable and resumable &mdash; while only a bounded handoff stays in the context window.</p>
  </article>
  <article class="card">
    <h2>Why bother</h2>
    <p>An analog to model reasoning, test-time compute fanout across a panel of models can perform better than single frontier models, or perform as well as frontier models on some benchmarks at a fraction of the cost, or latency.</p>
  </article>
  <article class="card">
    <h2>When to use it</h2>
    <p>Fuzzy bugs, unfamiliar code, refactors, reviews. Turn it off for tiny edits where latency costs more than the plan.</p>
  </article>
</section>

<p class="section-label">Get started</p>

<section class="grid" aria-label="Get started">
  <article class="card">
    <h2>One-line install</h2>
    <pre><code>pi install npm:@leblancfg/pi-fusion</code></pre>
    <p>All you need to get started.</p>
  </article>
  <article class="card">
    <h2>Open settings</h2>
    <pre><code>/fusion</code></pre>
    <p>Set worker count, choose planner tool access, pick models, and save/load your own presets from the TUI pane.</p>
  </article>
  <article class="card">
    <h2>Save and load presets</h2>
    <pre><code>/fusion preset list</code></pre>
    <p>Presets are saved in dotfiles. <a href="{{ '/presets/' | relative_url }}">Read more here.</a></p>
  </article>
</section>
