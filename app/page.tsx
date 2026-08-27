"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeGeneralized,
  DEFAULT_COMPUTE_CONFIG,
  deriveJoinHotspots,
  QUERY_SAMPLES,
  recordWorkload,
  runGeneralizedQuery,
  simulateCompute,
  type ComputeConfig,
  type GeneralizedRun,
  type WorkloadState,
} from "./generalized-optimizer";
import { formatCell, formatNumber, LAB_TABLES, type DataRow } from "./lab";

type OutputTab = "results" | "plan" | "data" | "workload";
const WORKLOAD_KEY = "loopbase-generalized-workload-v1";

function formatDuration(milliseconds: number): string {
  if (milliseconds >= 60_000) return `${(milliseconds / 60_000).toFixed(1)} min`;
  if (milliseconds >= 1_000) return `${(milliseconds / 1_000).toFixed(2)} s`;
  return `${milliseconds.toFixed(0)} ms`;
}

function formatDecimal(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function ResultTable({ rows, emptyMessage = "The query returned no rows." }: { rows: DataRow[]; emptyMessage?: string }) {
  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;
  const preview = rows.slice(0, 30);
  const columns = Object.keys(rows[0]);
  return (
    <div className="table-scroll">
      <table className="result-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{preview.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > preview.length && <div className="table-fade">Showing 30 of {formatNumber(rows.length)} rows</div>}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState<string>(QUERY_SAMPLES[0].sql);
  const [run, setRun] = useState<GeneralizedRun | null>(null);
  const [workload, setWorkload] = useState<WorkloadState>({});
  const [frequency, setFrequency] = useState(100);
  const [computeConfig, setComputeConfig] = useState<ComputeConfig>(DEFAULT_COMPUTE_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [tab, setTab] = useState<OutputTab>("results");
  const [selectedTable, setSelectedTable] = useState("orders");
  const [showAbout, setShowAbout] = useState(false);
  const initialized = useRef(false);

  const liveAnalysis = useMemo(() => analyzeGeneralized(query, workload), [query, workload]);
  const analysis = run?.analysis ?? liveAnalysis;
  const compute = useMemo(() => simulateCompute(analysis.plan, analysis.model, computeConfig), [analysis, computeConfig]);
  const hotspots = useMemo(() => deriveJoinHotspots(workload), [workload]);
  const table = LAB_TABLES.find((candidate) => candidate.name === selectedTable) ?? LAB_TABLES[0];
  const totalRows = LAB_TABLES.reduce((total, candidate) => total + candidate.data.length, 0);
  const workloadRuns = Object.values(workload).reduce((total, entry) => total + entry.runs, 0);
  const workloadRowWork = Object.values(workload).reduce((total, entry) => total + entry.rowWork, 0);
  const lineNumbers = Array.from({ length: Math.max(8, query.split("\n").length) }, (_, index) => index + 1);

  function saveWorkload(next: WorkloadState) {
    setWorkload(next);
    try { window.localStorage.setItem(WORKLOAD_KEY, JSON.stringify(next)); } catch { /* private mode can disable storage */ }
  }

  function execute(nextQuery: string = query, baseWorkload: WorkloadState = workload, record = true) {
    const nextWorkload = record ? recordWorkload(baseWorkload, nextQuery, frequency) : baseWorkload;
    if (record) saveWorkload(nextWorkload);
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        setRun(runGeneralizedQuery(nextQuery, nextWorkload));
        setTab("results");
      } catch (caught) {
        setRun(null);
        setError(caught instanceof Error ? caught.message : "The query could not be executed.");
      } finally {
        setRunning(false);
      }
    }, 40);
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    let restored: WorkloadState = {};
    try { restored = JSON.parse(window.localStorage.getItem(WORKLOAD_KEY) ?? "{}"); } catch { restored = {}; }
    const initial = recordWorkload(restored, QUERY_SAMPLES[0].sql, 100);
    saveWorkload(initial);
    execute(QUERY_SAMPLES[0].sql, initial, false);
  // Mount once: future runs are explicit editor actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadExample(exampleId: string) {
    const sample = QUERY_SAMPLES.find((candidate) => candidate.id === exampleId) ?? QUERY_SAMPLES[0];
    setQuery(sample.sql);
    execute(sample.sql);
  }

  function resetWorkload() {
    saveWorkload({});
    setRun(runGeneralizedQuery(query, {}));
  }

  function updateCompute(key: keyof ComputeConfig, value: number) {
    setComputeConfig((current) => ({ ...current, [key]: value }));
  }

  const healthClass = analysis.health >= 82 ? "good" : analysis.health >= 60 ? "warn" : "risk";
  const findingCount = analysis.findings.length;
  const planMax = Math.max(1, ...analysis.plan.map((step) => step.cost));
  const estimatedSavings = run?.rewritten ? Math.max(0, Math.round((1 - run.rewritten.analysis.estimatedCost / Math.max(1, run.analysis.estimatedCost)) * 100)) : 0;
  const latencyReduction = Math.max(0, (1 - compute.selected.estimatedMs / compute.baseline.estimatedMs) * 100);
  const usageChange = (compute.selected.computeSeconds / compute.baseline.computeSeconds - 1) * 100;

  return (
    <main className="shell">
      <aside className="rail" aria-label="Dataset explorer">
        <div className="brand-mark" aria-hidden="true">L/</div>
        <div className="rail-copy"><p className="eyebrow">WORKSPACE</p><h1>Retail<br />sandbox</h1><p className="dataset-note">{LAB_TABLES.length} tables · {formatNumber(totalRows)} deterministic rows. Generated locally.</p></div>
        <div className="table-list">{LAB_TABLES.map((item) => (
          <button className={`table-row ${selectedTable === item.name ? "active" : ""}`} key={item.name} type="button" onClick={() => { setSelectedTable(item.name); setTab("data"); }}><span className={`table-dot ${item.tone}`} /><span>{item.name}</span><small>{formatNumber(item.data.length)}</small></button>
        ))}</div>
        <div className="schema-note"><span>RELATIONSHIPS</span><p>customers.id → orders.customer_id</p><p>orders.id → items + payments + shipments</p><p>products.id → inventory</p><p>suppliers.id → products.supplier_id</p><p className="materialized-relation">↳ materializations generated on demand</p></div>
        <div className="rail-footer"><span className="status-dot" /> Engine ready</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">QUERY WORKBENCH</p><h2>Find the expensive part.</h2></div>
          <div className="top-actions">
            <label className="example-picker"><span className="sr-only">Load sample input</span><select defaultValue={QUERY_SAMPLES[0].id} onChange={(event) => loadExample(event.target.value)}>{QUERY_SAMPLES.map((sample) => <option value={sample.id} key={sample.id}>{sample.label}</option>)}</select></label>
            <button className="avatar-button" type="button" aria-label="About the lab" onClick={() => setShowAbout((visible) => !visible)}>?</button>
            {showAbout && <div className="about-popover"><strong>The samples are inputs, not answer keys.</strong><p>Every plan, finding, join hotspot, rewrite, materialization, and parallelism estimate is generated from the submitted SQL, actual table statistics, workload, and compute profile. The multi-node lab is a Snowflake-like simulation; it does not connect to Snowflake.</p><button type="button" onClick={() => setShowAbout(false)}>Got it</button></div>}
          </div>
        </header>

        <div className="work-grid">
          <section className="editor-card">
            <div className="card-bar"><div className="file-tab"><span className="live-dot" /> scratch.sql</div><span className="engine-label">READ-ONLY / IN-BROWSER SQL</span></div>
            <div className="editor-wrap"><div className="line-nums" aria-hidden="true">{lineNumbers.map((line) => <span key={line}>{line}</span>)}</div><textarea aria-label="SQL query" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); execute(); } }} /></div>
            <div className="editor-actions"><span><kbd>⌘</kbd><kbd>↵</kbd> to run</span><div className="run-controls"><label className="frequency-control"><span>Modeled runs / week</span><input aria-label="Modeled runs per week" type="number" min="1" max="100000" value={frequency} onChange={(event) => setFrequency(Math.max(1, Math.min(100000, Number(event.target.value) || 1)))} /></label><button className="run-button" type="button" disabled={running} onClick={() => execute()}><span>{running ? "●" : "▶"}</span> {running ? "Running…" : "Run & analyze"}</button></div></div>
          </section>

          <aside className={`score-card ${healthClass}`}>
            <div className="score-top"><p className="eyebrow">QUERY HEALTH</p><span className="score-badge">{findingCount} {findingCount === 1 ? "finding" : "findings"}</span></div>
            <div className="score-ring" style={{ "--score": `${analysis.health * 3.6}deg` } as React.CSSProperties}><div><strong>{analysis.health}</strong><span>/100</span></div></div>
            <p className="score-caption">{analysis.health >= 82 ? "Clean query shape. Inspect the plan before shipping." : "Valid shape, but avoidable work remains in the plan."}</p>
            <div className="metric-row"><span>Rows touched</span><strong>{formatNumber(analysis.touchedRows)}</strong></div><div className="metric-row"><span>Result rows</span><strong>{run ? formatNumber(run.rows.length) : "—"}</strong></div><div className="metric-row"><span>Browser runtime</span><strong>{run ? `${run.elapsedMs.toFixed(2)} ms` : "—"}</strong></div><div className="metric-row"><span>Cluster simulation</span><strong>{compute.config.nodes} nodes / {compute.selected.totalWorkers} workers</strong></div><div className="metric-row"><span>Estimated cluster time</span><strong>{formatDuration(compute.selected.estimatedMs)}</strong></div>
          </aside>
        </div>

        <section className="output-card">
          <div className="output-tabs" role="tablist" aria-label="Query output"><button className={tab === "results" ? "active" : ""} type="button" onClick={() => setTab("results")}>Results {run && <span>{formatNumber(run.rows.length)}</span>}</button><button className={tab === "plan" ? "active" : ""} type="button" onClick={() => setTab("plan")}>Execution plan <span>{analysis.plan.length}</span></button><button className={tab === "data" ? "active" : ""} type="button" onClick={() => setTab("data")}>Sample data</button><button className={tab === "workload" ? "active" : ""} type="button" onClick={() => setTab("workload")}>Join overlap <span>{hotspots.length}</span></button><div className="output-meta">{analysis.referencedTables.length ? analysis.referencedTables.join(" + ") : "No table detected"}</div></div>
          {error && <div className="query-error"><strong>Query stopped</strong><span>{error}</span></div>}
          {!error && tab === "results" && (running ? <div className="empty-state pulse">Executing against {formatNumber(totalRows)} local rows…</div> : <ResultTable rows={run?.rows ?? []} />)}
          {!error && tab === "plan" && <div className="plan-list">
            <div className="parallel-summary"><div><span>MAX PARALLELISM</span><strong>{analysis.parallelism.maxWorkers} workers</strong></div><div><span>SCHEDULE</span><strong>{analysis.parallelism.waves} waves</strong></div><div><span>CRITICAL PATH</span><strong>{formatNumber(analysis.parallelism.criticalPath)} units</strong></div><div><span>UTILIZATION</span><strong>{analysis.parallelism.efficiency}%</strong></div><p>{analysis.parallelism.serialBottleneck ? `${analysis.parallelism.serialBottleneck} is the largest serial bottleneck.` : "No dominant serial stage in this modeled plan."}</p></div>
            <div className="plan-legend"><span>Operations sharing a wave can overlap</span><small>Bar length = relative work</small></div>
            {analysis.plan.map((step, index) => <div className="plan-row" key={`${step.operation}-${index}`}><span className={`plan-node ${step.tone}`}>{index + 1}</span><div className="plan-copy"><strong>{step.operation}</strong><p>{step.detail}</p><small>Wave {step.parallelGroup ?? 1} · {step.workers ?? 1} {(step.workers ?? 1) === 1 ? "worker" : "workers"}</small></div><div className="plan-bar-track"><span style={{ width: `${Math.max(5, (step.cost / planMax) * 100)}%` }} /></div><div className="plan-stat"><strong>{formatNumber(step.rows)}</strong><span>rows out</span></div><div className="plan-stat"><strong>{formatNumber(step.cost)}</strong><span>work</span></div></div>)}
          </div>}
          {!error && tab === "data" && <div className="data-view"><div className="data-head"><div><p className="eyebrow">TABLE PREVIEW</p><h3>{table.name}</h3><span>{table.label} · {formatNumber(table.data.length)} rows</span></div><div className="column-chips">{table.columns.map((column) => <span key={column.name}>{column.name} <small>{column.type}{column.key ? ` · ${column.key}` : ""}</small></span>)}</div></div><ResultTable rows={table.data.slice(0, 12)} /></div>}
          {!error && tab === "workload" && <div className="workload-view">
            <div className="workload-summary"><div><p className="eyebrow">OBSERVED QUERY LOG</p><h3>Repeated joins learned from your runs</h3><span>Each run contributes the frequency entered beside the Run button.</span></div><div className="workload-stat"><strong>{formatNumber(workloadRuns)}</strong><span>modeled join executions</span></div><div className="workload-stat accent"><strong>{formatNumber(workloadRowWork)}</strong><span>join-row work</span></div><button className="reset-workload" type="button" onClick={resetWorkload}>Reset workload</button></div>
            {hotspots.length ? <><div className="hotspot-table-wrap"><table className="hotspot-table"><thead><tr><th>Observed relationship</th><th>Runs</th><th>Row work</th><th>Generated structure</th><th>Action</th><th>Modeled gain</th></tr></thead><tbody>{hotspots.map((hotspot, index) => <tr key={hotspot.signature} className={index === 0 ? "recommended" : ""}><td><span className="hotspot-rank">{index + 1}</span><strong>{hotspot.pair}</strong></td><td>{formatNumber(hotspot.runs)}</td><td>{formatNumber(hotspot.rowWork)}</td><td><code>{hotspot.recommendation}</code></td><td>{hotspot.action}</td><td><strong>{hotspot.gain}%</strong></td></tr>)}</tbody></table></div><div className="materialization-explainer"><span>TOP REUSE CANDIDATE</span><p><code>{hotspots[0].pair}</code> accounts for the most observed row work. The optimizer generated <code>{hotspots[0].recommendation}</code> from that join signature; it was not predefined in the dataset.</p></div></> : <div className="empty-state">Run a query with a join to build the workload profile.</div>}
          </div>}
        </section>

        <section className="compute-lab">
          <div className="compute-heading">
            <div><p className="eyebrow">MULTI-NODE SCALING LAB</p><h3>What changes when this query gets 5 VMs?</h3><p>Snowflake-like MPP simulation using this query’s scans, joins, exchanges, serial stages, and estimated row widths.</p></div>
            <span>SIMULATED · NO SNOWFLAKE CONNECTION</span>
          </div>
          <div className="compute-controls">
            <label><span>Compute nodes / VMs</span><input aria-label="Compute nodes" type="number" min="1" max="16" value={computeConfig.nodes} onChange={(event) => updateCompute("nodes", Number(event.target.value))} /></label>
            <label><span>Workers / node</span><input aria-label="Workers per node" type="number" min="1" max="16" value={computeConfig.workersPerNode} onChange={(event) => updateCompute("workersPerNode", Number(event.target.value))} /></label>
            <label><span>Memory / node</span><div><input aria-label="Memory gigabytes per node" type="number" min="1" max="128" value={computeConfig.memoryGbPerNode} onChange={(event) => updateCompute("memoryGbPerNode", Number(event.target.value))} /><small>GB</small></div></label>
            <label><span>Sample data scale</span><div><input aria-label="Data scale multiplier" type="number" min="1" max="100000" value={computeConfig.dataScale} onChange={(event) => updateCompute("dataScale", Number(event.target.value))} /><small>×</small></div></label>
            <label><span>Scan bandwidth</span><div><input aria-label="Scan gigabytes per second per node" type="number" min="0.1" max="20" step="0.1" value={computeConfig.scanGbpsPerNode} onChange={(event) => updateCompute("scanGbpsPerNode", Number(event.target.value))} /><small>GB/s</small></div></label>
            <label><span>Network bandwidth</span><div><input aria-label="Network gigabytes per second per node" type="number" min="0.1" max="20" step="0.1" value={computeConfig.networkGbpsPerNode} onChange={(event) => updateCompute("networkGbpsPerNode", Number(event.target.value))} /><small>GB/s</small></div></label>
            <label className="skew-control"><span>Join-key skew <strong>{computeConfig.skewPercent}%</strong></span><input aria-label="Join key skew percent" type="range" min="0" max="90" step="5" value={computeConfig.skewPercent} onChange={(event) => updateCompute("skewPercent", Number(event.target.value))} /></label>
          </div>

          <div className="compute-verdict">
            <div><span>{compute.selected.nodes} NODE RESULT</span><strong>{formatDecimal(compute.selected.speedup, 2)}× faster</strong></div>
            <p>Estimated latency falls <strong>{formatDecimal(latencyReduction)}%</strong> versus one node, with <strong>{formatDecimal(compute.selected.efficiency)}%</strong> scaling efficiency. Total compute-seconds {usageChange >= 0 ? "rise" : "fall"} <strong>{formatDecimal(Math.abs(usageChange))}%</strong>; the current bottleneck is <strong>{compute.selected.bottleneck}</strong>. {compute.selected.speedup > compute.selected.nodes && "The superlinear gain comes from added cluster memory eliminating baseline spill."}</p>
            <div className="data-volume"><span>MODELED VOLUME</span><strong>{formatDecimal(compute.scanGb, 2)} GB scan</strong><small>{formatDecimal(compute.exchangeGb, 2)} GB join/exchange · {formatDecimal(compute.workingSetGb, 2)} GB peak working set</small></div>
          </div>

          <div className="scaling-cards">
            {compute.scenarios.map((scenario) => (
              <article className={scenario.nodes === compute.config.nodes ? "selected" : ""} key={scenario.nodes}>
                <div className="scenario-title"><span>{scenario.nodes}</span><div><strong>{scenario.nodes === 1 ? "node" : "nodes"}</strong><small>{scenario.totalWorkers} workers</small></div></div>
                <strong className="scenario-time">{formatDuration(scenario.estimatedMs)}</strong>
                <div className="speedup-track"><span style={{ width: `${Math.max(4, scenario.speedup / Math.max(...compute.scenarios.map((item) => item.speedup)) * 100)}%` }} /></div>
                <div className="scenario-metrics"><span>Speedup <strong>{formatDecimal(scenario.speedup, 2)}×</strong></span><span>Efficiency <strong>{formatDecimal(scenario.efficiency)}%</strong></span><span>Usage <strong>{formatDecimal(scenario.computeSeconds, 2)} node-s</strong></span><span>Spill <strong>{formatDecimal(scenario.spillGb, 2)} GB</strong></span></div>
                <p>{scenario.bottleneck} bound</p>
              </article>
            ))}
          </div>

          <div className="stage-table-wrap"><table className="stage-table">
            <thead><tr><th>Nodes</th><th>Scan</th><th>Compute</th><th>Network exchange</th><th>Spill I/O</th><th>Total</th><th>Scaling efficiency</th></tr></thead>
            <tbody>{compute.scenarios.map((scenario) => <tr key={scenario.nodes} className={scenario.nodes === compute.config.nodes ? "selected" : ""}><td><strong>{scenario.nodes}</strong></td><td>{formatDuration(scenario.scanMs)}</td><td>{formatDuration(scenario.computeMs)}</td><td>{formatDuration(scenario.exchangeMs)}</td><td>{formatDuration(scenario.spillMs)}</td><td><strong>{formatDuration(scenario.estimatedMs)}</strong></td><td>{formatDecimal(scenario.efficiency)}%</td></tr>)}</tbody>
          </table></div>
        </section>

        <section className="findings-section"><div className="section-heading"><div><p className="eyebrow">OPTIMIZATION PATH</p><h3>{findingCount ? `${findingCount} changes worth considering` : "No obvious anti-patterns"}</h3></div><span>Computed from this SQL + data + workload</span></div><div className="findings-grid">{analysis.findings.map((finding, index) => <article className="finding-card" key={finding.id}><div className="finding-meta"><span className="finding-index">{String(index + 1).padStart(2, "0")}</span><span className={`impact-pill ${finding.impact}`}>{finding.impact} impact</span></div><h4>{finding.title}</h4><p>{finding.detail}</p><div className="fix-block"><span>TRY THIS</span><strong>{finding.fix}</strong></div><div className="gain-line"><span>Estimated effect</span><strong>{finding.estimatedGain}</strong></div></article>)}{!findingCount && <article className="clean-card"><span>✓</span><div><strong>Good query shape</strong><p>No structural anti-pattern was detected. Use the generated plan to validate cardinality, parallelism, and volume.</p></div></article>}</div></section>

        {run?.rewritten ? <section className="comparison-card"><div className="comparison-intro"><p className="eyebrow">TESTED REWRITE</p><h3>{run.analysis.rewriteLabel}</h3><p>The generated candidate ran against the same data. Modeled work falls <strong>{estimatedSavings}%</strong>; equality is checked across the complete result set.</p><div className={`equality-badge ${run.rewritten.sameResult ? "match" : "review"}`}><span>{run.rewritten.sameResult ? "✓" : "!"}</span>{run.rewritten.sameResult ? "Exact result match" : "Output differs — review semantics"}</div></div><div className="compare-metrics"><div className="compare-column baseline"><span>BASELINE</span><strong>{formatNumber(run.analysis.estimatedCost)}</strong><small>work units</small><p>{run.elapsedMs.toFixed(2)} ms measured</p></div><div className="compare-arrow">→</div><div className="compare-column candidate"><span>REWRITE</span><strong>{formatNumber(run.rewritten.analysis.estimatedCost)}</strong><small>work units</small><p>{run.rewritten.elapsedMs.toFixed(2)} ms measured</p></div></div><div className="rewrite-code"><div className="rewrite-bar"><span>optimized.sql</span><button type="button" onClick={() => { setQuery(run.rewritten!.sql); execute(run.rewritten!.sql); }}>Load into editor</button></div><pre>{run.rewritten.sql}</pre>{run.analysis.rewriteDDL && <details><summary>Generated materialized-view DDL</summary><pre>{run.analysis.rewriteDDL}</pre></details>}</div></section> : <section className="manual-note"><span>NO SAFE SQL REWRITE</span><p>The generalized analyzer did not find a rewrite it could execute and verify without changing semantics. Any remaining findings still describe schema-, grain-, index-, or workload-level changes.</p></section>}

        <footer className="lab-footer"><span>LOOPBASE / GENERALIZED QUERY LAB</span><p>{LAB_TABLES.length} physical tables · actual execution + measured equality · workload-derived recommendations</p></footer>
      </section>
    </main>
  );
}
