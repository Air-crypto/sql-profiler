"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeQuery,
  EXAMPLES,
  formatCell,
  formatNumber,
  LAB_TABLES,
  runLabQuery,
  type DataRow,
  type QueryRun,
} from "./lab";

type OutputTab = "results" | "plan" | "data";

function ResultTable({ rows, emptyMessage = "The query returned no rows." }: { rows: DataRow[]; emptyMessage?: string }) {
  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;
  const preview = rows.slice(0, 30);
  const columns = Object.keys(rows[0]);
  return (
    <div className="table-scroll">
      <table className="result-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {preview.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > preview.length && <div className="table-fade">Showing 30 of {formatNumber(rows.length)} rows</div>}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState<string>(EXAMPLES[0].sql);
  const [run, setRun] = useState<QueryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [tab, setTab] = useState<OutputTab>("results");
  const [selectedTable, setSelectedTable] = useState("orders");
  const [showAbout, setShowAbout] = useState(false);
  const initialized = useRef(false);

  const liveAnalysis = useMemo(() => analyzeQuery(query), [query]);
  const analysis = run?.analysis ?? liveAnalysis;
  const table = LAB_TABLES.find((candidate) => candidate.name === selectedTable) ?? LAB_TABLES[0];
  const lineNumbers = Array.from({ length: Math.max(8, query.split("\n").length) }, (_, index) => index + 1);

  function execute(nextQuery: string = query) {
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        setRun(runLabQuery(nextQuery));
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
    execute(EXAMPLES[0].sql);
  // The first deterministic run is intentionally mount-only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadExample(exampleId: string) {
    const example = EXAMPLES.find((candidate) => candidate.id === exampleId) ?? EXAMPLES[0];
    setQuery(example.sql);
    execute(example.sql);
  }

  function showTable(name: string) {
    setSelectedTable(name);
    setTab("data");
  }

  const healthClass = analysis.health >= 82 ? "good" : analysis.health >= 60 ? "warn" : "risk";
  const findingCount = analysis.findings.length;
  const planMax = Math.max(1, ...analysis.plan.map((step) => step.cost));
  const estimatedSavings = run?.rewritten
    ? Math.max(0, Math.round((1 - run.rewritten.analysis.estimatedCost / run.analysis.estimatedCost) * 100))
    : 0;

  return (
    <main className="shell">
      <aside className="rail" aria-label="Dataset explorer">
        <div className="brand-mark" aria-hidden="true">L/</div>
        <div className="rail-copy">
          <p className="eyebrow">WORKSPACE</p>
          <h1>Retail<br />sandbox</h1>
          <p className="dataset-note">17,300 deterministic records. Generated locally, reset on refresh.</p>
        </div>
        <div className="table-list">
          {LAB_TABLES.map((item) => (
            <button
              className={`table-row ${selectedTable === item.name ? "active" : ""}`}
              key={item.name}
              type="button"
              onClick={() => showTable(item.name)}
            >
              <span className={`table-dot ${item.tone}`} />
              <span>{item.name}</span>
              <small>{formatNumber(item.data.length)}</small>
            </button>
          ))}
        </div>
        <div className="schema-note">
          <span>RELATIONSHIPS</span>
          <p>customers.id → orders.customer_id</p>
          <p>orders.id → order_items.order_id</p>
          <p>products.id → order_items.product_id</p>
        </div>
        <div className="rail-footer"><span className="status-dot" /> Engine ready</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">QUERY WORKBENCH</p>
            <h2>Find the expensive part.</h2>
          </div>
          <div className="top-actions">
            <label className="example-picker">
              <span className="sr-only">Load example</span>
              <select defaultValue={EXAMPLES[0].id} onChange={(event) => loadExample(event.target.value)}>
                {EXAMPLES.map((example) => <option value={example.id} key={example.id}>{example.label}</option>)}
              </select>
            </label>
            <button className="avatar-button" type="button" aria-label="About the lab" onClick={() => setShowAbout((visible) => !visible)}>?</button>
            {showAbout && (
              <div className="about-popover">
                <strong>This is a transparent simulator.</strong>
                <p>Queries execute against real in-memory tables. Runtime is measured in your browser; scan cost and plans use visible heuristics so you can inspect the assumptions.</p>
                <button type="button" onClick={() => setShowAbout(false)}>Got it</button>
              </div>
            )}
          </div>
        </header>

        <div className="work-grid">
          <section className="editor-card">
            <div className="card-bar">
              <div className="file-tab"><span className="live-dot" /> scratch.sql</div>
              <span className="engine-label">READ-ONLY / IN-BROWSER SQL</span>
            </div>
            <div className="editor-wrap">
              <div className="line-nums" aria-hidden="true">{lineNumbers.map((line) => <span key={line}>{line}</span>)}</div>
              <textarea
                aria-label="SQL query"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    execute();
                  }
                }}
              />
            </div>
            <div className="editor-actions">
              <span><kbd>⌘</kbd><kbd>↵</kbd> to run</span>
              <button className="run-button" type="button" disabled={running} onClick={() => execute()}>
                <span>{running ? "●" : "▶"}</span> {running ? "Running…" : "Run & analyze"}
              </button>
            </div>
          </section>

          <aside className={`score-card ${healthClass}`}>
            <div className="score-top">
              <p className="eyebrow">QUERY HEALTH</p>
              <span className="score-badge">{findingCount} {findingCount === 1 ? "finding" : "findings"}</span>
            </div>
            <div className="score-ring" style={{ "--score": `${analysis.health * 3.6}deg` } as React.CSSProperties}>
              <div><strong>{analysis.health}</strong><span>/100</span></div>
            </div>
            <p className="score-caption">
              {analysis.health >= 82 ? "Clean query shape. Inspect the plan before shipping." : "Valid shape, but avoidable work remains in the plan."}
            </p>
            <div className="metric-row"><span>Rows touched</span><strong>{formatNumber(analysis.touchedRows)}</strong></div>
            <div className="metric-row"><span>Result rows</span><strong>{run ? formatNumber(run.rows.length) : "—"}</strong></div>
            <div className="metric-row"><span>Runtime</span><strong>{run ? `${run.elapsedMs.toFixed(2)} ms` : "—"}</strong></div>
            <div className="metric-row"><span>Work units</span><strong>{formatNumber(analysis.estimatedCost)}</strong></div>
          </aside>
        </div>

        <section className="output-card">
          <div className="output-tabs" role="tablist" aria-label="Query output">
            <button className={tab === "results" ? "active" : ""} type="button" onClick={() => setTab("results")}>Results {run && <span>{formatNumber(run.rows.length)}</span>}</button>
            <button className={tab === "plan" ? "active" : ""} type="button" onClick={() => setTab("plan")}>Execution plan <span>{analysis.plan.length}</span></button>
            <button className={tab === "data" ? "active" : ""} type="button" onClick={() => setTab("data")}>Sample data</button>
            <div className="output-meta">{analysis.referencedTables.length ? analysis.referencedTables.join(" + ") : "No table detected"}</div>
          </div>

          {error && <div className="query-error"><strong>Query stopped</strong><span>{error}</span></div>}
          {!error && tab === "results" && (
            running ? <div className="empty-state pulse">Executing against 17,300 local records…</div> : <ResultTable rows={run?.rows ?? []} />
          )}
          {!error && tab === "plan" && (
            <div className="plan-list">
              <div className="plan-legend"><span>Modeled execution order</span><small>Bar length = relative work</small></div>
              {analysis.plan.map((step, index) => (
                <div className="plan-row" key={`${step.operation}-${index}`}>
                  <span className={`plan-node ${step.tone}`}>{index + 1}</span>
                  <div className="plan-copy"><strong>{step.operation}</strong><p>{step.detail}</p></div>
                  <div className="plan-bar-track"><span style={{ width: `${Math.max(5, (step.cost / planMax) * 100)}%` }} /></div>
                  <div className="plan-stat"><strong>{formatNumber(step.rows)}</strong><span>rows out</span></div>
                  <div className="plan-stat"><strong>{formatNumber(step.cost)}</strong><span>work</span></div>
                </div>
              ))}
            </div>
          )}
          {!error && tab === "data" && (
            <div className="data-view">
              <div className="data-head">
                <div><p className="eyebrow">TABLE PREVIEW</p><h3>{table.name}</h3><span>{table.label} · {formatNumber(table.data.length)} rows</span></div>
                <div className="column-chips">
                  {table.columns.map((column) => <span key={column.name}>{column.name} <small>{column.type}{column.key ? ` · ${column.key}` : ""}</small></span>)}
                </div>
              </div>
              <ResultTable rows={table.data.slice(0, 12)} />
            </div>
          )}
        </section>

        <section className="findings-section">
          <div className="section-heading">
            <div><p className="eyebrow">OPTIMIZATION PATH</p><h3>{findingCount ? `${findingCount} changes worth considering` : "No obvious anti-patterns"}</h3></div>
            <span>Evidence tied to this query</span>
          </div>
          <div className="findings-grid">
            {analysis.findings.map((finding, index) => (
              <article className="finding-card" key={finding.id}>
                <div className="finding-meta">
                  <span className="finding-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className={`impact-pill ${finding.impact}`}>{finding.impact} impact</span>
                </div>
                <h4>{finding.title}</h4>
                <p>{finding.detail}</p>
                <div className="fix-block"><span>TRY THIS</span><strong>{finding.fix}</strong></div>
                <div className="gain-line"><span>Estimated effect</span><strong>{finding.estimatedGain}</strong></div>
              </article>
            ))}
            {!findingCount && (
              <article className="clean-card"><span>✓</span><div><strong>Good query shape</strong><p>The simulator found no common structural anti-patterns. Use the plan to validate cardinality and data volume.</p></div></article>
            )}
          </div>
        </section>

        {run?.rewritten ? (
          <section className="comparison-card">
            <div className="comparison-intro">
              <p className="eyebrow">TESTED REWRITE</p>
              <h3>{run.analysis.rewriteLabel}</h3>
              <p>The candidate ran against the same tables. Modeled work falls <strong>{estimatedSavings}%</strong>; result equality is checked across the complete result set.</p>
              <div className={`equality-badge ${run.rewritten.sameResult ? "match" : "review"}`}>
                <span>{run.rewritten.sameResult ? "✓" : "!"}</span>
                {run.rewritten.sameResult ? "Exact result match" : "Output differs — review semantics"}
              </div>
            </div>
            <div className="compare-metrics">
              <div className="compare-column baseline">
                <span>BASELINE</span>
                <strong>{formatNumber(run.analysis.estimatedCost)}</strong>
                <small>work units</small>
                <p>{run.elapsedMs.toFixed(2)} ms measured</p>
              </div>
              <div className="compare-arrow">→</div>
              <div className="compare-column candidate">
                <span>REWRITE</span>
                <strong>{formatNumber(run.rewritten.analysis.estimatedCost)}</strong>
                <small>work units</small>
                <p>{run.rewritten.elapsedMs.toFixed(2)} ms measured</p>
              </div>
            </div>
            <div className="rewrite-code">
              <div className="rewrite-bar"><span>optimized.sql</span><button type="button" onClick={() => { setQuery(run.rewritten!.sql); execute(run.rewritten!.sql); }}>Load into editor</button></div>
              <pre>{run.rewritten.sql}</pre>
            </div>
          </section>
        ) : (
          <section className="manual-note">
            <span>SCHEMA-LEVEL FIX</span>
            <p>This query’s best optimization requires an index, normalized column, or pre-aggregated table. The lab won’t invent a rewrite that could silently change the result.</p>
          </section>
        )}

        <footer className="lab-footer">
          <span>LOOPBASE / LOCAL QUERY LAB</span>
          <p>Actual rows + browser runtime · transparent modeled plans · no Snowflake connection</p>
        </footer>
      </section>
    </main>
  );
}
