import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeGeneralized,
  DEFAULT_COMPUTE_CONFIG,
  parseQueryModel,
  QUERY_SAMPLES,
  simulateCompute,
} from "../app/generalized-optimizer";

test("compares one, two, and five compute nodes for a complex query", () => {
  const analysis = analyzeGeneralized(QUERY_SAMPLES[1].sql);
  const simulation = simulateCompute(analysis.plan, analysis.model, DEFAULT_COMPUTE_CONFIG);
  assert.deepEqual(simulation.scenarios.map((scenario) => scenario.nodes), [1, 2, 5]);
  assert.ok(simulation.selected.estimatedMs < simulation.baseline.estimatedMs);
  assert.ok(simulation.selected.speedup > 1);
  assert.ok(simulation.selected.efficiency > 0 && simulation.selected.efficiency < 100);
  assert.ok(simulation.selected.exchangeMs > 0);
});

test("skew and memory pressure change the generated scaling result", () => {
  const analysis = analyzeGeneralized(QUERY_SAMPLES[1].sql);
  const balanced = simulateCompute(analysis.plan, analysis.model, { ...DEFAULT_COMPUTE_CONFIG, skewPercent: 0 });
  const skewed = simulateCompute(analysis.plan, analysis.model, { ...DEFAULT_COMPUTE_CONFIG, skewPercent: 70 });
  assert.ok(skewed.selected.estimatedMs > balanced.selected.estimatedMs);
  assert.ok(skewed.selected.efficiency < balanced.selected.efficiency);

  const constrained = simulateCompute(analysis.plan, analysis.model, { ...DEFAULT_COMPUTE_CONFIG, nodes: 1, memoryGbPerNode: 1, dataScale: 20_000 });
  const roomy = simulateCompute(analysis.plan, analysis.model, { ...DEFAULT_COMPUTE_CONFIG, nodes: 1, memoryGbPerNode: 128, dataScale: 20_000 });
  assert.ok(constrained.selected.spillGb > roomy.selected.spillGb);
  assert.ok(constrained.selected.estimatedMs > roomy.selected.estimatedMs);
});

test("multi-node simulation also works for SQL outside the sample menu", () => {
  const sql = `SELECT w.name, SUM(i.on_hand) AS stock
FROM warehouses w
JOIN inventory i ON w.id = i.warehouse_id
WHERE i.on_hand > 40
GROUP BY w.name
ORDER BY stock DESC;`;
  const model = parseQueryModel(sql);
  const analysis = analyzeGeneralized(sql);
  const simulation = simulateCompute(analysis.plan, model, { ...DEFAULT_COMPUTE_CONFIG, nodes: 5 });
  assert.deepEqual(model.tables.map((table) => table.name), ["warehouses", "inventory"]);
  assert.equal(model.joins.length, 1);
  assert.equal(simulation.selected.nodes, 5);
  assert.equal(simulation.selected.totalWorkers, 20);
});
