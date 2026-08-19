import assert from "node:assert/strict";
import { HALF_BAND, REF_MID, anchorGrid } from "../src/config.js";
import {
  assertFeeOk,
  assertMarginOk,
  buildGrid,
  computeRisk,
  planFromFillsAndSeed,
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

// 单边锁：long 只买不卖 / short 只卖不买——成交后不得补反向单（否则摩擦累计反向仓位）
function checkOneSideNoReverse() {  const g = buildGrid({ lower: 63000, upper: 67000, gridCount: 80 });
  const sizeBase = 0.0033;
  const mid = g.levels[40]!; // 网格中心
  const base = {
    market: "BTC",
    mid,
    levels: g.levels,
    spacing: g.spacing,
    sizeBase,
    openOrders: [] as Array<{ id: string; market: string; side: "buy" | "sell"; price: number; size: number; level: number }>,
    maxWrites: 20,
    seeded: true,
    skipBand: 0.5,
  };

  // long：买单成交（prevActive 有、openOrders 无）→ 不得补卖单
  {
    const prevActive = new Map([
      ["o1", { levelIndex: 10, side: "buy" as const, price: g.levels[10]!, size: sizeBase }],
    ]);
    const plan = planFromFillsAndSeed({ ...base, mode: "long", prevActive });
    const sells = plan.intents.filter((i) => i.type === "place" && i.order.side === "sell");
    assert.equal(sells.length, 0, "long 模式买成交后不得补卖单");
  }
  // short：卖单成交 → 不得补买单
  {
    const prevActive = new Map([
      ["o2", { levelIndex: 70, side: "sell" as const, price: g.levels[70]!, size: sizeBase }],
    ]);
    const plan = planFromFillsAndSeed({ ...base, mode: "short", prevActive });
    const buys = plan.intents.filter((i) => i.type === "place" && i.order.side === "buy");
    assert.equal(buys.length, 0, "short 模式卖成交后不得补买单");
  }
  console.log("one-side no-reverse OK");
}
checkOneSideNoReverse();

// 叠单去重：同 level 两个单（同价同向），只保留 orderId 最小的，撤另一个（确定性，不依赖数组顺序）
function checkDupDedupDeterministic() {
  const g = buildGrid({ lower: 63000, upper: 67000, gridCount: 80 });
  const sizeBase = 0.0033;
  const mid = g.levels[40]!;
  const lvl = g.levels[10]!; // 某个固定 level
  const mkOrder = (id: string, price: number) => ({
    id,
    market: "BTC",
    side: "buy" as const,
    price,
    size: sizeBase,
    level: 10,
  });
  // 两个单落在同一 level（价格略有抖动但都在容差内）
  const oA = mkOrder("10", lvl + 0.01);
  const oB = mkOrder("9", lvl + 0.02);
  const base = {
    market: "BTC",
    mid,
    levels: g.levels,
    spacing: g.spacing,
    sizeBase,
    maxWrites: 20,
    seeded: true,
    skipBand: 0.5,
  };
  // 顺序 A,B
  const p1 = planFromFillsAndSeed({
    ...base,
    mode: "neutral",
    openOrders: [oA, oB],
    prevActive: new Map(),
  });
  // 顺序 B,A
  const p2 = planFromFillsAndSeed({
    ...base,
    mode: "neutral",
    openOrders: [oB, oA],
    prevActive: new Map(),
  });
  const cancels1 = p1.intents.filter((i) => i.type === "cancel").map((i: any) => i.orderId);
  const cancels2 = p2.intents.filter((i) => i.type === "cancel").map((i: any) => i.orderId);
  // 核心：无论输入顺序，撤掉的是同一个 orderId（确定性），且只撤 1 个
  assert.deepEqual(cancels1, cancels2, "两种顺序应撤掉同一个 orderId（确定性）");
  assert.equal(cancels1.length, 1, "只撤 1 个叠单");
  console.log("dup-dedup deterministic OK");
}
checkDupDedupDeterministic();

console.log("grid.test.ts OK");
