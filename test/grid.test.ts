import assert from "node:assert/strict";
import { HALF_BAND, REF_MID, anchorGrid } from "../src/config.js";
import {
  assertFeeOk,
  assertMarginOk,
  buildGrid,
  computeRisk,
  seedOrders,
} from "../src/grid.js";

function checkVenue(label: string, gridCount: number, expectEach: number, mid: number) {
  const base = {
    lower: 0,
    upper: 0,
    halfBand: HALF_BAND,
    gridCount,
    sizeBase: 0,
    leverage: 30,
    feeRate: 0.0005,
    equityUsd: 800,
    marginFraction: 0.3,
    maxWritesPerTick: 10,
    mode: "neutral" as const,
    skipBand: 0.25,
  };
  const anchored = anchorGrid(base, mid);
  const g = buildGrid({
    lower: anchored.lower,
    upper: anchored.upper,
    gridCount,
  });
  assert.equal(g.levels.length, gridCount + 1);
  const expectHalf = mid * (HALF_BAND / REF_MID);
  assert.ok(Math.abs(anchored.lower - (mid - expectHalf)) < 1e-6);
  assert.ok(Math.abs(anchored.upper - (mid + expectHalf)) < 1e-6);

  const seeds = seedOrders({
    levels: g.levels,
    price: mid,
    mode: "neutral",
    spacing: g.spacing,
  });
  const buys = seeds.filter((s) => s.side === "buy").length;
  const sells = seeds.filter((s) => s.side === "sell").length;
  assert.equal(buys, expectEach, `${label} buy`);
  assert.equal(sells, expectEach, `${label} sell`);

  const risk = computeRisk(
    g,
    {
      sizeBase: anchored.sizeBase,
      leverage: 30,
      equityUsd: 800,
      marginFraction: 0.3,
    },
    mid
  );
  const fee = assertFeeOk(risk.spacingPct, 0.0005);
  assert.equal(fee.ok, true, `${label} fee ${fee.message}`);
  const margin = assertMarginOk(risk, 800, 0.3);
  assert.equal(margin.ok, true, `${label} margin`);
  console.log(
    `${label}: mid=${mid} count=${gridCount} ≈上下各${expectEach} spacing=${g.spacing.toFixed(2)} size=${anchored.sizeBase} perRung≈${risk.perRungProfit}U spacingPct=${risk.spacingPct}%`
  );
}

for (const mid of [65_000, 97_500, 120_000]) {
  checkVenue(`ext/n1@${mid}`, 80, 40, mid);
  checkVenue(`ris/dec@${mid}`, 50, 25, mid);
}

console.log("grid.test.ts OK");
