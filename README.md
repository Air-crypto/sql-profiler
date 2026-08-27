# Loopbase SQL Profiler

A credential-free SQL workbench for learning where query time and compute spend go. It executes arbitrary read-only SQL against deterministic in-browser tables, derives optimizations from the SQL and data, and simulates how the same plan scales across a Snowflake-like multi-node compute cluster.

Live demo: [loopbase-sql-lab.aircrypto.chatgpt.site](https://loopbase-sql-lab.aircrypto.chatgpt.site)

No Snowflake account, ChatGPT login, API key, database, or cloud credentials are required to clone and run the project locally.

## What it does

- Executes SQL against 12 realistic retail and supply-chain tables with 96,734 sample rows.
- Parses submitted SQL into tables, aliases, join edges, cardinalities, and plan stages.
- Detects fan-out, many-to-many joins, wrapped predicates, unbounded sorts, full projections, and other structural issues.
- Learns repeated joins from the queries run in the browser instead of using a predefined hotspot list.
- Generates materialized-view candidates from observed join signatures.
- Executes safe rewrites and checks equality across the complete result set.
- Models scan, filter, exchange, join, aggregation, and serial merge stages.
- Compares 1, 2, and 5-node plans, plus any selected cluster size from 1–16 nodes.
- Exposes workers per node, memory, scan bandwidth, network bandwidth, data scale, and join-key skew.
- Reports estimated latency, speedup, scaling efficiency, compute-seconds, exchange time, spill I/O, and the current bottleneck.

The sample-query menu only fills the editor. Findings, rewrites, materializations, workload hotspots, and compute results are generated from the submitted query and current settings.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
git clone https://github.com/Air-crypto/sql-profiler.git
cd sql-profiler
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validate the project

```bash
npm test
npm run lint
```

The test suite builds the production worker, verifies the rendered application, exercises SQL outside the sample menu, compares 1/2/5-node scaling, and checks that skew and memory pressure change the result.

## Multi-node model

This project does not call Snowflake. It is a transparent MPP-style simulation built from:

- plan work and row estimates derived from the SQL;
- data-type-based row-width estimates;
- per-node scan and network throughput;
- available workers and memory;
- join-key skew;
- repartition/exchange volume;
- memory spill and coordination overhead; and
- serial stages such as a global ordered merge.

The data-scale control projects the deterministic sample tables to a larger production-sized workload while preserving their observed shape. Results are comparative estimates, not a claim about a specific Snowflake warehouse size or bill.

## Architecture

- `app/lab.ts` creates and executes against the deterministic AlaSQL dataset.
- `app/generalized-optimizer.ts` parses queries, builds plans, learns workload overlap, generates rewrites, and runs the multi-node simulation.
- `app/page.tsx` contains the interactive workbench.
- `worker/index.ts` is the Cloudflare-compatible production entry point.
- `tests/` covers rendering, generalization, equality, and scaling behavior.

Workload history is stored only in the visitor's browser using `localStorage`. The application has no server-side user store and sends no SQL or credentials to Snowflake, OpenAI, or another database service.

## Deployment note

`.openai/hosting.json` contains the non-secret project identifier for the public demo. It is not needed for local development. Anyone deploying a separate copy should create their own hosting project and replace that identifier; no deployment token is committed to this repository.
