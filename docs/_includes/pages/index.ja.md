<p class="section-label">Installation</p>
<div class="install" aria-label="インストールコマンド">
  <pre><code>pi install npm:@leblancfg/pi-fusion</code></pre>
</div>

<figure class="diagram">
  <img src="{{ '/assets/fusion-map.svg' | relative_url }}" alt="Prompt が optional discovery と rewrite に流れ、その後 planner workers を経由して final synthesis turn に入る。" />
  <figcaption class="caption">OpenRouter の hosted Fusion route ではなく、ローカルの pi subprocesses を使います。Discovery と rewrite は optional です。</figcaption>
</figure>


<section class="grid" aria-label="仕組み">
  <article class="card">
    <h2>何をするか</h2>
    <p>Workers が configurable な tool access で並列に計画し、その notes が synthesis prompt へ注入されます。完全な sub-agent transcripts は 1 つの <a href="https://pi.dev/docs/latest/session-format#tree-structure">pi session file</a> に archive され、audit と resume が可能です。一方、context window に残るのは bounded handoff だけです。</p>
  </article>
  <article class="card">
    <h2>なぜ使うか</h2>
    <p>model reasoning の類似物として、複数モデルの panel に test-time compute を fanout すると、単一の frontier model より良い結果になる場合があります。また、一部の benchmark では、frontier model と同等の品質を、より低い cost や latency で得られることがあります。</p>
  </article>
  <article class="card">
    <h2>使いどころ</h2>
    <p>あいまいなバグ、未知の code、refactor、review に向いています。latency が計画の価値を上回るような小さな編集では off にしてください。</p>
  </article>
</section>

<p class="section-label">Get started</p>

<section class="grid" aria-label="Get started">
  <article class="card">
    <h2>1 行でインストール</h2>
    <pre><code>pi install npm:@leblancfg/pi-fusion</code></pre>
    <p>開始に必要なのはこれだけです。</p>
  </article>
  <article class="card">
    <h2>設定を開く</h2>
    <pre><code>/fusion</code></pre>
    <p>worker 数、planner tool access、models を選び、TUI pane から自分用の presets を保存・読み込みできます。</p>
  </article>
  <article class="card">
    <h2>presets を保存・読み込み</h2>
    <pre><code>/fusion preset list</code></pre>
    <p>Presets は dotfiles に保存されます。<a href="{{ '/ja/presets/' | relative_url }}">詳しくはこちら。</a></p>
  </article>
</section>
