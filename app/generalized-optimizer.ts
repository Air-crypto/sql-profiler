import alasql from "alasql";
import {
  executeLabSQL,
  getLabTable,
  LAB_TABLES,
  registerRuntimeTable,
  type DataRow,
  type Finding,
  type LabTable,
  type PlanStep,
  type QueryAnalysis,
  type QueryRun,
  type TableColumn,
} from "./lab";

// These are input examples only. No recommendation or rewrite is keyed by ID;
// every answer is derived from the SQL structure, table statistics, and the
// workload counters supplied to the analyzer.
export const QUERY_SAMPLES = [
  {
    id: "materialization-candidate",
    label: "Reusable customer-order join",
    sql: `SELECT c.region,
       c.segment,
       COUNT(*) AS order_count,
       SUM(o.total_amount) AS revenue,
       AVG(o.total_amount) AS avg_order_value
FROM customers c
JOIN orders o ON c.id = o.customer_id
WHERE o.created_at >= '2025-01-01'
  AND o.created_at < '2026-01-01'
  AND o.status IN ('paid', 'shipped')
GROUP BY c.region, c.segment
ORDER BY revenue DESC;`,
  },
  {
    id: "supply-chain-revenue",
    label: "8-table supply-chain revenue",
    sql: `SELECT c.region AS customer_region,
       pc.department,
       s.name AS supplier,
       w.name AS warehouse,
       COUNT(*) AS joined_rows,
       SUM(oi.quantity * oi.unit_price) AS gross_revenue,
       SUM(sh.shipping_cost) AS shipping_cost
FROM customers c
JOIN orders o ON c.id = o.customer_id
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
JOIN product_categories pc ON pc.id = p.category_id
JOIN suppliers s ON s.id = p.supplier_id
JOIN shipments sh ON sh.order_id = o.id
JOIN warehouses w ON w.id = sh.warehouse_id
WHERE o.created_at >= '2025-01-01'
  AND o.status IN ('paid', 'shipped')
GROUP BY c.region, pc.department, s.name, w.name
ORDER BY gross_revenue DESC;`,
  },
  {
    id: "customer-360-fanout",
    label: "Customer 360 join fan-out",
    sql: `SELECT c.id,
       c.name,
       cp.loyalty_tier,
       COUNT(*) AS joined_rows,
       SUM(o.total_amount) AS order_value,
       SUM(pay.amount) AS captured_value
FROM customers c
JOIN customer_profiles cp ON cp.customer_id = c.id
JOIN orders o ON o.customer_id = c.id
JOIN payments pay ON pay.order_id = o.id
JOIN support_tickets st ON st.customer_id = c.id
WHERE pay.state = 'captured'
  AND st.resolved = false
GROUP BY c.id, c.name, cp.loyalty_tier
ORDER BY captured_value DESC;`,
  },
  {
    id: "inventory-network",
    label: "5-table inventory risk",
    sql: `SELECT w.region AS warehouse_region,
       pc.department,
       s.name AS supplier,
       COUNT(*) AS inventory_rows,
       SUM(i.on_hand) AS units,
       SUM(i.on_hand * p.unit_price) AS inventory_value
FROM inventory i
JOIN warehouses w ON w.id = i.warehouse_id
JOIN products p ON p.id = i.product_id
JOIN product_categories pc ON pc.id = p.category_id
JOIN suppliers s ON s.id = p.supplier_id
WHERE i.on_hand < i.reorder_point
GROUP BY w.region, pc.department, s.name
ORDER BY inventory_value DESC;`,
  },
  {
    id: "non-sargable-date",
    label: "Function-wrapped date filter",
    sql: `SELECT c.region,
       COUNT(*) AS order_count,
       SUM(o.total_amount) AS revenue
FROM customers c
JOIN orders o ON c.id = o.customer_id
WHERE YEAR(o.created_at) = 2025
GROUP BY c.region
ORDER BY revenue DESC;`,
  },
  {
    id: "membership-subquery",
    label: "Membership subquery",
    sql: `SELECT o.customer_id,
       COUNT(*) AS order_count,
       SUM(o.total_amount) AS revenue
FROM orders o
WHERE o.customer_id IN (
  SELECT c.id FROM customers c WHERE c.region = 'West'
)
GROUP BY o.customer_id
ORDER BY revenue DESC;`,
  },
] as const;

export type TableRef = {
  name: string;
  alias: string;
  rows: number;
};

export type JoinEndpoint = {
  table: string;
  alias: string;
  column: string;
  rows: number;
  distinct: number;
  unique: boolean;
};

export type JoinEdge = {
  signature: string;
  mode: string;
  left: JoinEndpoint;
  right: JoinEndpoint;
  relationship: "1:1" | "1:N" | "N:1" | "N:N";
  estimatedRows: number;
};

export type QueryModel = {
  tables: TableRef[];
  joins: JoinEdge[];
  hasWhere: boolean;
  hasGroup: boolean;
  hasOrder: boolean;
  hasLimit: boolean;
  hasSelectStar: boolean;
};

export type WorkloadEntry = {
  signature: string;
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  relationship: JoinEdge["relationship"];
  runs: number;
  rowWork: number;
  queries: number;
};

export type WorkloadState = Record<string, WorkloadEntry>;

export type WorkloadHotspot = WorkloadEntry & {
  pair: string;
  recommendation: string;
  action: "Materialize" | "Pre-aggregate";
  gain: number;
};

type AstRecord = Record<string, unknown>;
type ColumnRef = { alias: string; column: string };

const generatedMaterializations = new Map<string, LabTable>();

function record(value: unknown): AstRecord | null {
  return value !== null && typeof value === "object" ? value as AstRecord : null;
}

function tableRef(value: unknown): { name: string; alias: string } | null {
  const node = record(value);
  if (!node || typeof node.tableid !== "string") return null;
  const name = node.tableid.toLowerCase();
  const alias = typeof node.as === "string" ? node.as.toLowerCase() : name;
  return { name, alias };
}

function columnRef(value: unknown): ColumnRef | null {
  const node = record(value);
  if (!node) return null;
  if (typeof node.columnid === "string") {
    return {
      alias: typeof node.tableid === "string" ? node.tableid.toLowerCase() : "",
      column: node.columnid.toLowerCase(),
    };
  }
  return node.expression ? columnRef(node.expression) : null;
}

function equalityColumns(value: unknown): [ColumnRef, ColumnRef] | null {
  const node = record(value);
  if (!node) return null;
  if (node.op === "=") {
    const left = columnRef(node.left);
    const right = columnRef(node.right);
    if (left && right) return [left, right];
  }
  for (const candidate of [node.expression, node.left, node.right]) {
    const found = equalityColumns(candidate);
    if (found) return found;
  }
  return null;
}

function distinctCount(table: LabTable | undefined, column: string): number {
  if (!table) return 0;
  return new Set(table.data.map((row) => row[column]).filter((value) => value !== null && value !== undefined)).size;
}

function endpoint(table: string, alias: string, column: string): JoinEndpoint {
  const source = getLabTable(table);
  const rows = source?.data.length ?? 0;
  const distinct = distinctCount(source, column);
  return { table, alias, column, rows, distinct, unique: rows > 0 && distinct === rows };
}

function joinSignature(left: JoinEndpoint, right: JoinEndpoint): string {
  const endpoints = [`${left.table}.${left.column}`, `${right.table}.${right.column}`].sort();
  return endpoints.join("=");
}

function describeRelationship(left: JoinEndpoint, right: JoinEndpoint): JoinEdge["relationship"] {
  if (left.unique && right.unique) return "1:1";
  if (left.unique) return "1:N";
  if (right.unique) return "N:1";
  return "N:N";
}

function estimateJoinRows(left: JoinEndpoint, right: JoinEndpoint): number {
  const denominator = Math.max(1, left.distinct, right.distinct);
  return Math.max(1, Math.round((left.rows * right.rows) / denominator));
}

function fallbackModel(sql: string): QueryModel {
  const aliases = new Map<string, string>();
  const tables: TableRef[] = [];
  const source = /\b(?:from|join)\s+([a-z_][\w]*)(?:\s+(?:as\s+)?([a-z_][\w]*))?/gi;
  let match: RegExpExecArray | null;
  while ((match = source.exec(sql)) !== null) {
    const name = match[1].toLowerCase();
    if (!getLabTable(name)) continue;
    const alias = (match[2] || name).toLowerCase();
    if (["on", "where", "group", "order", "limit", "join"].includes(alias)) continue;
    aliases.set(alias, name);
    if (!tables.some((table) => table.alias === alias)) tables.push({ name, alias, rows: getLabTable(name)!.data.length });
  }
  const joins: JoinEdge[] = [];
  const on = /\bon\s+([a-z_][\w]*)\.([a-z_][\w]*)\s*=\s*([a-z_][\w]*)\.([a-z_][\w]*)/gi;
  while ((match = on.exec(sql)) !== null) {
    const leftTable = aliases.get(match[1].toLowerCase());
    const rightTable = aliases.get(match[3].toLowerCase());
    if (!leftTable || !rightTable) continue;
    const left = endpoint(leftTable, match[1].toLowerCase(), match[2].toLowerCase());
    const right = endpoint(rightTable, match[3].toLowerCase(), match[4].toLowerCase());
    joins.push({ signature: joinSignature(left, right), mode: "INNER", left, right, relationship: describeRelationship(left, right), estimatedRows: estimateJoinRows(left, right) });
  }
  return queryFlags(sql, tables, joins);
}

function queryFlags(sql: string, tables: TableRef[], joins: JoinEdge[]): QueryModel {
  return {
    tables,
    joins,
    hasWhere: /\bwhere\b/i.test(sql),
    hasGroup: /\bgroup\s+by\b/i.test(sql),
    hasOrder: /\border\s+by\b/i.test(sql),
    hasLimit: /\blimit\s+\d+/i.test(sql),
    hasSelectStar: /\bselect\s+(?:[a-z_]\w*\.)?\*/i.test(sql),
  };
}

export function parseQueryModel(sql: string): QueryModel {
  try {
    const parsed = alasql.parse(sql) as unknown as AstRecord;
    const statements = Array.isArray(parsed.statements) ? parsed.statements : [];
    const select = record(statements[0]);
    if (!select) return fallbackModel(sql);
    const tables: TableRef[] = [];
    const aliases = new Map<string, string>();
    const from = Array.isArray(select.from) ? select.from : [];
    for (const value of from) {
      const source = tableRef(value);
      if (!source || !getLabTable(source.name)) continue;
      aliases.set(source.alias, source.name);
      tables.push({ ...source, rows: getLabTable(source.name)!.data.length });
    }

    const joins: JoinEdge[] = [];
    const astJoins = Array.isArray(select.joins) ? select.joins : [];
    for (const value of astJoins) {
      const join = record(value);
      const source = tableRef(join?.table);
      if (!join || !source || !getLabTable(source.name)) continue;
      const alias = typeof join.as === "string" ? join.as.toLowerCase() : source.alias;
      aliases.set(alias, source.name);
      tables.push({ name: source.name, alias, rows: getLabTable(source.name)!.data.length });
      const columns = equalityColumns(join.on);
      if (!columns) continue;
      const [leftColumn, rightColumn] = columns;
      const leftTable = aliases.get(leftColumn.alias);
      const rightTable = aliases.get(rightColumn.alias);
      if (!leftTable || !rightTable) continue;
      const left = endpoint(leftTable, leftColumn.alias, leftColumn.column);
      const right = endpoint(rightTable, rightColumn.alias, rightColumn.column);
      joins.push({
        signature: joinSignature(left, right),
        mode: typeof join.joinmode === "string" ? join.joinmode : "INNER",
        left,
        right,
        relationship: describeRelationship(left, right),
        estimatedRows: estimateJoinRows(left, right),
      });
    }
    return queryFlags(sql, tables, joins);
  } catch {
    return fallbackModel(sql);
  }
}

export function recordWorkload(previous: WorkloadState, sql: string, modeledRuns: number): WorkloadState {
  const runs = Math.max(1, Math.min(100000, Math.round(modeledRuns || 1)));
  const model = parseQueryModel(sql);
  const next = { ...previous };
  for (const join of model.joins) {
    const existing = next[join.signature];
    const rowWorkPerRun = join.left.rows + join.right.rows + join.estimatedRows;
    next[join.signature] = {
      signature: join.signature,
      leftTable: join.left.table,
      leftColumn: join.left.column,
      rightTable: join.right.table,
      rightColumn: join.right.column,
      relationship: join.relationship,
      runs: (existing?.runs ?? 0) + runs,
      rowWork: (existing?.rowWork ?? 0) + rowWorkPerRun * runs,
      queries: (existing?.queries ?? 0) + 1,
    };
  }
  return next;
}

function candidateName(entry: Pick<WorkloadEntry, "leftTable" | "rightTable" | "leftColumn" | "rightColumn">): string {
  return `mat_${entry.leftTable}_${entry.rightTable}_${entry.leftColumn}_${entry.rightColumn}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 62);
}

export function deriveJoinHotspots(workload: WorkloadState): WorkloadHotspot[] {
  return Object.values(workload)
    .map((entry) => {
      const left = getLabTable(entry.leftTable);
      const right = getLabTable(entry.rightTable);
      const leftRows = left?.data.length ?? 0;
      const rightRows = right?.data.length ?? 0;
      const output = Math.max(leftRows, rightRows);
      const base = Math.max(1, leftRows + rightRows + output);
      const materialized = Math.max(1, Math.round(output * 0.78));
      const gain = Math.max(5, Math.min(82, Math.round((1 - materialized / base) * 100)));
      return {
        ...entry,
        pair: `${entry.leftTable}.${entry.leftColumn} ↔ ${entry.rightTable}.${entry.rightColumn}`,
        recommendation: candidateName(entry),
        action: entry.relationship === "N:N" ? "Pre-aggregate" as const : "Materialize" as const,
        gain,
      };
    })
    .sort((left, right) => right.rowWork - left.rowWork);
}

function workloadForJoin(workload: WorkloadState, signature: string): WorkloadEntry | undefined {
  return workload[signature];
}

function independentFanout(model: QueryModel): { parent: string; children: string[] } | null {
  for (const table of model.tables) {
    const manyChildren: string[] = [];
    for (const join of model.joins) {
      if (join.left.table === table.name && join.left.unique && !join.right.unique) manyChildren.push(join.right.table);
      if (join.right.table === table.name && join.right.unique && !join.left.unique) manyChildren.push(join.left.table);
    }
    if (new Set(manyChildren).size >= 2) return { parent: table.name, children: [...new Set(manyChildren)] };
  }
  return null;
}

function selectivity(sql: string): number {
  if (/\blike\s+'%/i.test(sql)) return 0.55;
  if (/\b(?:year|lower|upper|cast|substring)\s*\(/i.test(sql)) return 0.72;
  if (/\bin\s*\(/i.test(sql)) return 0.32;
  if (/>=|<=|\bbetween\b/i.test(sql)) return 0.35;
  if (/\s=\s/i.test(sql)) return 0.16;
  return 0.5;
}

function workersFor(rows: number, ceiling = 8): number {
  return Math.max(1, Math.min(ceiling, Math.ceil(rows / 5_000)));
}

function buildPlan(sql: string, model: QueryModel): { plan: PlanStep[]; touchedRows: number; estimatedCost: number } {
  const plan: PlanStep[] = [];
  let touchedRows = 0;
  const whereText = sql.match(/\bwhere\b([\s\S]*?)(?:\bgroup\s+by\b|\border\s+by\b|\blimit\b|$)/i)?.[1] ?? "";
  const ratio = selectivity(sql);
  for (const table of model.tables) {
    const source = getLabTable(table.name);
    if (!source) continue;
    const filtered = model.hasWhere && (new RegExp(`\\b${table.alias}\\.`, "i").test(whereText) || model.tables.length === 1);
    const wrapped = filtered && /\b(?:year|lower|upper|cast|substring)\s*\(/i.test(whereText);
    const rows = filtered && !wrapped ? Math.max(1, Math.round(source.data.length * ratio)) : source.data.length;
    const materialized = table.name.startsWith("mat_");
    const cost = Math.round(rows * (materialized ? 0.72 : 1));
    touchedRows += rows;
    plan.push({
      operation: materialized ? "MATERIALIZED SCAN" : "SCAN",
      detail: filtered && !wrapped ? `Predicate pushdown on ${table.name}` : `Read ${table.name}`,
      rows,
      cost,
      tone: "scan",
      parallelGroup: 1,
      workers: workersFor(rows),
    });
  }

  if (model.hasWhere) {
    const input = Math.max(1, ...plan.map((step) => step.rows));
    const output = Math.max(1, Math.round(input * ratio));
    plan.push({
      operation: "FILTER",
      detail: /\b(?:year|lower|upper|cast|substring)\s*\(/i.test(whereText) ? "Evaluate transformed predicate row by row" : "Apply remaining predicates",
      rows: output,
      cost: Math.round(input * 0.24),
      tone: "filter",
      parallelGroup: 1,
      workers: workersFor(input),
    });
  }

  if (model.tables.length >= 3) {
    const exchangeRows = model.tables.reduce((total, table) => total + table.rows, 0);
    plan.push({
      operation: "EXCHANGE",
      detail: `Repartition ${model.tables.length} source streams by join keys`,
      rows: exchangeRows,
      cost: Math.round(exchangeRows * 0.18),
      tone: "compute",
      parallelGroup: 2,
      workers: Math.min(8, Math.max(2, model.tables.length)),
    });
  }

  for (const join of model.joins) {
    const joinIndex = model.joins.indexOf(join);
    plan.push({
      operation: join.relationship === "N:N" ? "MANY-MANY JOIN" : "HASH JOIN",
      detail: `${join.left.table}.${join.left.column} = ${join.right.table}.${join.right.column} · ${join.relationship}`,
      rows: join.estimatedRows,
      cost: Math.round((join.left.rows + join.right.rows + join.estimatedRows) * (join.relationship === "N:N" ? 1.25 : 0.68)),
      tone: "join",
      parallelGroup: 2 + joinIndex,
      workers: Math.max(2, workersFor(join.estimatedRows)),
    });
  }
  if (/\bin\s*\(\s*select\b/i.test(sql)) {
    const rows = Math.max(1, ...plan.map((step) => step.rows));
    plan.push({ operation: "SUBQUERY", detail: "Build and probe membership result", rows, cost: Math.round(rows * 1.1), tone: "compute", parallelGroup: 2, workers: Math.max(2, workersFor(rows)) });
  }
  let streamRows = Math.max(1, ...plan.map((step) => step.rows));
  const computeWave = Math.max(2, model.joins.length + 2);
  if (model.hasGroup) {
    streamRows = Math.max(1, Math.round(Math.sqrt(streamRows) * 3));
    plan.push({ operation: "AGGREGATE", detail: "Parallel partial aggregation, then merge groups", rows: streamRows, cost: streamRows * 4, tone: "compute", parallelGroup: computeWave, workers: Math.max(2, workersFor(streamRows)) });
  }
  if (model.hasOrder) {
    plan.push({ operation: "SORT", detail: model.hasLimit ? "Top-N ordered result" : "Serial merge of the globally ordered result", rows: streamRows, cost: Math.round(streamRows * Math.log2(streamRows + 1)), tone: "compute", parallelGroup: computeWave + 1, workers: 1 });
  }
  return { plan, touchedRows, estimatedCost: plan.reduce((total, step) => total + step.cost, 0) };
}

export type ParallelismSummary = {
  maxWorkers: number;
  waves: number;
  totalWork: number;
  criticalPath: number;
  efficiency: number;
  serialBottleneck: string | null;
};

function summarizeParallelism(plan: PlanStep[]): ParallelismSummary {
  const maxWorkers = Math.max(1, ...plan.map((step) => step.workers ?? 1));
  const waves = Math.max(1, ...plan.map((step) => step.parallelGroup ?? 1));
  const totalWork = plan.reduce((total, step) => total + step.cost, 0);
  let criticalPath = 0;
  for (let wave = 1; wave <= waves; wave += 1) {
    const duration = Math.max(
      0,
      ...plan
        .filter((step) => (step.parallelGroup ?? 1) === wave)
        .map((step) => step.cost / Math.max(1, step.workers ?? 1)),
    );
    criticalPath += duration;
  }
  const efficiency = totalWork === 0 ? 100 : Math.max(1, Math.min(100, Math.round((totalWork / Math.max(1, criticalPath * maxWorkers)) * 100)));
  const serial = plan
    .filter((step) => (step.workers ?? 1) === 1)
    .sort((left, right) => right.cost - left.cost)[0];
  return {
    maxWorkers,
    waves,
    totalWork,
    criticalPath: Math.round(criticalPath),
    efficiency,
    serialBottleneck: serial && serial.cost >= totalWork * 0.08 ? serial.operation : null,
  };
}

function genericFindings(sql: string, model: QueryModel, workload: WorkloadState): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => {
    if (!findings.some((existing) => existing.id === finding.id)) findings.push(finding);
  };
  const fanout = independentFanout(model);
  if (fanout) {
    add({
      id: "independent-fanout",
      title: `${fanout.children.length} many-sided joins branch from ${fanout.parent}`,
      detail: `${fanout.children.join(" and ")} can multiply one another before aggregation, inflating both work and totals.`,
      fix: `Aggregate each child to the ${fanout.parent} key first, then join those compact results.`,
      impact: "high",
      estimatedGain: "correct totals + smaller intermediates",
    });
  }
  const manyMany = model.joins.find((join) => join.relationship === "N:N");
  if (manyMany) {
    add({
      id: `many-many-${manyMany.signature}`,
      title: `Many-to-many join detected on ${manyMany.left.column}`,
      detail: `Neither ${manyMany.left.table}.${manyMany.left.column} nor ${manyMany.right.table}.${manyMany.right.column} is unique in the sample data.`,
      fix: "Confirm the intended grain, then deduplicate or aggregate one side before joining.",
      impact: "high",
      estimatedGain: `${manyMany.estimatedRows.toLocaleString()} modeled output rows`,
    });
  }
  if (model.hasSelectStar) {
    add({
      id: "projection",
      title: "The query projects every available column",
      detail: `SELECT * carries the full width of ${model.tables.map((table) => table.name).join(", ")} through the result.`,
      fix: "Name only the columns required by the consumer so the data contract and row width stay controlled.",
      impact: "medium",
      estimatedGain: "less data copied and serialized",
    });
  }
  if (/\b(?:year|lower|upper|cast|substring)\s*\([^)]*\)\s*(?:=|like|>|<)/i.test(sql)) {
    const fn = sql.match(/\b(year|lower|upper|cast|substring)\s*\(/i)?.[1]?.toUpperCase() ?? "FUNCTION";
    add({
      id: "wrapped-filter",
      title: `${fn} wraps a filtered column`,
      detail: "The engine must transform candidate values before it can apply the predicate.",
      fix: "Compare the stored column directly, or persist an indexed normalized value when the transformation is required.",
      impact: "high",
      estimatedGain: "enables predicate pushdown",
    });
  }
  if (/\blike\s+'%/i.test(sql)) {
    add({
      id: "leading-wildcard",
      title: "Leading-wildcard search scans the source",
      detail: "A conventional ordered index cannot seek to a value when the pattern begins with %.",
      fix: "Use a token/search index or constrain the product behavior to a prefix lookup.",
      impact: "high",
      estimatedGain: "scan → indexed search",
    });
  }
  if (model.hasOrder && !model.hasLimit && !model.hasGroup) {
    add({
      id: "unbounded-sort",
      title: "The final sort has no row bound",
      detail: "Every qualifying row must be retained and sorted before the first page is returned.",
      fix: "Add a LIMIT for exploration or paginate by a stable sort key.",
      impact: "medium",
      estimatedGain: "lower memory and latency",
    });
  }
  const largeUnfiltered = !model.hasWhere ? model.tables.filter((table) => table.rows >= 10000) : [];
  if (largeUnfiltered.length) {
    add({
      id: "unfiltered-large-source",
      title: `${largeUnfiltered.map((table) => table.name).join(", ")} read without a filter`,
      detail: "The query scans the entire current history on every execution.",
      fix: "Push a selective date, state, or key predicate to the source scan.",
      impact: "high",
      estimatedGain: `${largeUnfiltered.reduce((total, table) => total + table.rows, 0).toLocaleString()} rows currently exposed`,
    });
  }
  for (const join of model.joins) {
    const observed = workloadForJoin(workload, join.signature);
    if (!observed || observed.runs < 25) continue;
    const candidate = candidateName(observed);
    const hotspot = deriveJoinHotspots({ [join.signature]: observed })[0];
    add({
      id: `workload-${join.signature}`,
      title: `${join.left.table} ↔ ${join.right.table} repeats ${observed.runs.toLocaleString()} times`,
      detail: `Observed workload modeling attributes ${observed.rowWork.toLocaleString()} row-work units to this relationship.`,
      fix: `${hotspot.action} the relationship as ${candidate}; refresh it when either source changes.`,
      impact: observed.rowWork >= 1_000_000 ? "high" : "medium",
      estimatedGain: `${hotspot.gain}% modeled work reduction`,
    });
  }
  if (model.tables.length >= 5) {
    add({
      id: "deep-join-graph",
      title: `${model.tables.length} source tables enlarge the plan search`,
      detail: "Cardinality errors compound as the engine chooses an order across the join graph.",
      fix: "Isolate stable dimensions and pre-aggregate high-grain facts into reusable intermediate models.",
      impact: "medium",
      estimatedGain: "fewer join permutations and spills",
    });
  }
  return findings
    .sort((left, right) => ({ high: 3, medium: 2, low: 1 }[right.impact] - { high: 3, medium: 2, low: 1 }[left.impact]))
    .slice(0, 6);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function yearRangeRewrite(sql: string): { sql: string; label: string } | null {
  let changed = false;
  const rewritten = sql.replace(
    /YEAR\s*\(\s*([a-z_][\w.]*?)\s*\)\s*=\s*(20\d{2})/gi,
    (_full, column: string, yearText: string) => {
      changed = true;
      const year = Number(yearText);
      return `${column} >= '${year}-01-01' AND ${column} < '${year + 1}-01-01'`;
    },
  );
  return changed ? { sql: rewritten, label: "Convert the year expression to a bounded range" } : null;
}

function membershipRewrite(sql: string): { sql: string; label: string } | null {
  const pattern = /\bWHERE\s+([a-z_]\w*)\.([a-z_]\w*)\s+IN\s*\(\s*SELECT\s+([a-z_]\w*)\.([a-z_]\w*)\s+FROM\s+([a-z_]\w*)\s+(?:AS\s+)?([a-z_]\w*)\s+WHERE\s+([\s\S]*?)\)\s*(?=(GROUP\s+BY|ORDER\s+BY|LIMIT|$))/i;
  const match = sql.match(pattern);
  if (!match) return null;
  const [, outerAlias, outerColumn, selectedAlias, selectedColumn, innerTable, innerAlias, innerPredicate] = match;
  if (selectedAlias.toLowerCase() !== innerAlias.toLowerCase()) return null;
  const source = getLabTable(innerTable.toLowerCase());
  if (!source || distinctCount(source, selectedColumn.toLowerCase()) !== source.data.length) return null;
  const replacement = `JOIN ${innerTable} ${innerAlias} ON ${innerAlias}.${selectedColumn} = ${outerAlias}.${outerColumn}\nWHERE ${innerPredicate.trim()}\n`;
  return { sql: sql.replace(pattern, replacement), label: `Replace the unique membership subquery with a join to ${innerTable}` };
}

function tableToken(name: string, alias: string): string {
  return alias === name ? escapeRegExp(name) : `${escapeRegExp(name)}\\s+(?:AS\\s+)?${escapeRegExp(alias)}`;
}

function materializedColumns(table: LabTable, prefix: string): TableColumn[] {
  return table.columns.map((column) => ({ ...column, name: `${prefix}__${column.name}`, key: undefined }));
}

function materializationFor(sql: string, model: QueryModel, workload: WorkloadState): { sql: string; label: string; ddl: string } | null {
  if (model.joins.length !== 1 || model.tables.length !== 2 || model.hasSelectStar) return null;
  const join = model.joins[0];
  const observed = workloadForJoin(workload, join.signature);
  if (!observed || observed.runs < 25 || join.mode.toUpperCase() !== "INNER" || join.left.table === join.right.table) return null;

  const leftTable = getLabTable(join.left.table);
  const rightTable = getLabTable(join.right.table);
  if (!leftTable || !rightTable || join.estimatedRows > 150000) return null;
  const name = candidateName(observed);
  let materialized = generatedMaterializations.get(name);
  if (!materialized) {
    const index = new Map<DataRow[string], DataRow[]>();
    for (const row of rightTable.data) {
      const key = row[join.right.column];
      const rows = index.get(key) ?? [];
      rows.push(row);
      index.set(key, rows);
    }
    const data: DataRow[] = [];
    for (const leftRow of leftTable.data) {
      for (const rightRow of index.get(leftRow[join.left.column]) ?? []) {
        const merged: DataRow = {};
        for (const [column, value] of Object.entries(leftRow)) merged[`${join.left.table}__${column}`] = value;
        for (const [column, value] of Object.entries(rightRow)) merged[`${join.right.table}__${column}`] = value;
        data.push(merged);
      }
    }
    materialized = {
      name,
      label: `Generated ${join.left.table} + ${join.right.table} materialization`,
      tone: "coral",
      columns: [...materializedColumns(leftTable, join.left.table), ...materializedColumns(rightTable, join.right.table)],
      data,
    };
    generatedMaterializations.set(name, materialized);
    registerRuntimeTable(materialized);
  }

  const base = model.tables[0];
  const joined = model.tables[1];
  const baseEndpoint = join.left.alias === base.alias ? join.left : join.right;
  const joinedEndpoint = join.left.alias === joined.alias ? join.left : join.right;
  const from = new RegExp(
    `\\bFROM\\s+${tableToken(base.name, base.alias)}\\s+(?:INNER\\s+)?JOIN\\s+${tableToken(joined.name, joined.alias)}\\s+ON\\s+(?:${escapeRegExp(baseEndpoint.alias)}\\.${escapeRegExp(baseEndpoint.column)}\\s*=\\s*${escapeRegExp(joinedEndpoint.alias)}\\.${escapeRegExp(joinedEndpoint.column)}|${escapeRegExp(joinedEndpoint.alias)}\\.${escapeRegExp(joinedEndpoint.column)}\\s*=\\s*${escapeRegExp(baseEndpoint.alias)}\\.${escapeRegExp(baseEndpoint.column)})`,
    "i",
  );
  let rewritten = sql.replace(from, `FROM ${name} m`);
  if (rewritten === sql) return null;
  for (const table of model.tables) {
    const source = getLabTable(table.name)!;
    for (const column of source.columns) {
      rewritten = rewritten.replace(new RegExp(`\\b${escapeRegExp(table.alias)}\\.${escapeRegExp(column.name)}\\b`, "gi"), `m.${table.name}__${column.name}`);
    }
  }

  const fromIndex = rewritten.search(/\bFROM\b/i);
  const selectMatch = rewritten.slice(0, fromIndex).match(/^\s*SELECT\s+([\s\S]*)$/i);
  if (!selectMatch) return null;
  const items = splitTopLevel(selectMatch[1]);
  const safe = items.every((item) => /^m\.[a-z0-9_]+__[a-z0-9_]+$/i.test(item) || /\s+AS\s+[a-z_]\w*$/i.test(item));
  if (!safe) return null;
  const aliasedItems = items.map((item) => {
    const simple = item.match(/^m\.[a-z0-9_]+__([a-z0-9_]+)$/i);
    return simple ? `${item} AS ${simple[1]}` : item;
  });
  rewritten = `SELECT ${aliasedItems.join(",\n       ")}\n${rewritten.slice(fromIndex)}`;
  const ddlColumns = [...leftTable.columns.map((column) => `${join.left.alias}.${column.name} AS ${join.left.table}__${column.name}`), ...rightTable.columns.map((column) => `${join.right.alias}.${column.name} AS ${join.right.table}__${column.name}`)].join(",\n  ");
  const ddl = `CREATE MATERIALIZED VIEW ${name} AS\nSELECT\n  ${ddlColumns}\nFROM ${join.left.table} ${join.left.alias}\nJOIN ${join.right.table} ${join.right.alias}\n  ON ${join.left.alias}.${join.left.column} = ${join.right.alias}.${join.right.column};`;
  return { sql: rewritten, label: `Use generated materialization ${name}`, ddl };
}

function genericRewrite(sql: string, model: QueryModel, workload: WorkloadState): { sql: string; label: string; ddl: string | null } | null {
  const year = yearRangeRewrite(sql);
  const afterYear = year?.sql ?? sql;
  const materialization = materializationFor(afterYear, model, workload);
  if (materialization) {
    return { sql: materialization.sql, label: year ? `${year.label}, then ${materialization.label}` : materialization.label, ddl: materialization.ddl };
  }
  if (year) return { ...year, ddl: null };
  const membership = membershipRewrite(sql);
  return membership ? { ...membership, ddl: null } : null;
}

export type GeneralizedAnalysis = QueryAnalysis & {
  model: QueryModel;
  rewriteDDL: string | null;
  parallelism: ParallelismSummary;
};

export type GeneralizedRun = Omit<QueryRun, "analysis" | "rewritten"> & {
  analysis: GeneralizedAnalysis;
  rewritten: null | {
    sql: string;
    rows: DataRow[];
    elapsedMs: number;
    analysis: GeneralizedAnalysis;
    sameResult: boolean;
  };
};

export function analyzeGeneralized(sql: string, workload: WorkloadState = {}): GeneralizedAnalysis {
  const model = parseQueryModel(sql);
  const findings = genericFindings(sql, model, workload);
  const measured = buildPlan(sql, model);
  const rewrite = genericRewrite(sql, model, workload);
  const penalty = findings.reduce((score, finding) => score + ({ high: 17, medium: 10, low: 5 }[finding.impact]), 0);
  return {
    model,
    health: Math.max(24, 100 - penalty),
    findings,
    touchedRows: measured.touchedRows,
    estimatedCost: measured.estimatedCost,
    referencedTables: model.tables.map((table) => table.name),
    plan: measured.plan,
    parallelism: summarizeParallelism(measured.plan),
    rewriteSQL: rewrite?.sql ?? null,
    rewriteLabel: rewrite?.label ?? null,
    rewriteDDL: rewrite?.ddl ?? null,
  };
}

function stableRows(rows: DataRow[]): string {
  const canonical = rows.map((row) => JSON.stringify(Object.fromEntries(
    Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, typeof value === "number" ? Math.round(value * 1_000_000) / 1_000_000 : value]),
  )));
  return JSON.stringify(canonical.sort());
}

export function runGeneralizedQuery(sql: string, workload: WorkloadState = {}): GeneralizedRun {
  const analysis = analyzeGeneralized(sql, workload);
  const baseline = executeLabSQL(sql);
  let rewritten: GeneralizedRun["rewritten"] = null;
  if (analysis.rewriteSQL) {
    try {
      const candidate = executeLabSQL(analysis.rewriteSQL);
      rewritten = {
        sql: analysis.rewriteSQL,
        rows: candidate.rows,
        elapsedMs: candidate.elapsedMs,
        analysis: analyzeGeneralized(analysis.rewriteSQL, workload),
        sameResult: stableRows(baseline.rows) === stableRows(candidate.rows),
      };
    } catch {
      rewritten = null;
    }
  }
  return { ...baseline, analysis, rewritten };
}

export function physicalTableCount(): number {
  return LAB_TABLES.length;
}
