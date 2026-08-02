import { loadEnv } from "./loadEnv.js";

let lastSentAt = 0;
const MIN_GAP_MS = 1500;
const recentKeys = new Map<string, number>();

const VENUE_LABEL: Record<string, string> = {
  extended: "Extended",
  risex: "RISEx",
  decibel: "Decibel",
  n1: "N1",
  phoenix: "Phoenix",
};

function venueLabel(id: string): string {
  return VENUE_LABEL[id] || id;
}

function enabled(): boolean {
  loadEnv();
  const v = String(process.env.TELEGRAM_ENABLED || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function token(): string {
  return (process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN || "").trim();
}

function chatIds(): string[] {
  const raw =
    process.env.TELEGRAM_CHAT_IDS ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.TG_CHAT_ID ||
    "";
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function shouldSend(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const prev = recentKeys.get(key) || 0;
  if (now - prev < ttlMs) return false;
  recentKeys.set(key, now);
  if (recentKeys.size > 200) {
    for (const [k, t] of recentKeys) {
      if (now - t > ttlMs) recentKeys.delete(k);
    }
  }
  return true;
}

export async function tgSend(
  text: string,
  opts?: { key?: string; ttlMs?: number }
): Promise<boolean> {
  if (!enabled()) return false;
  const tok = token();
  const chats = chatIds();
  if (!tok || !chats.length) return false;
  if (opts?.key && !shouldSend(opts.key, opts.ttlMs ?? 60_000)) return false;

  const now = Date.now();
  const wait = lastSentAt + MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSentAt = Date.now();

  const body = encodeURIComponent(text.slice(0, 3500));
  let ok = false;
  for (const chat of chats) {
    try {
      const url = `https://api.telegram.org/bot${tok}/sendMessage?chat_id=${encodeURIComponent(
        chat
      )}&text=${body}&disable_web_page_preview=1`;
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(12_000) });
      if (res.ok) ok = true;
      else console.error(`[tg] HTTP ${res.status} chat=${chat}`);
    } catch (e: any) {
      console.error(`[tg] send failed: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return ok;
}

export async function tgError(venue: string, msg: string): Promise<void> {
  const short = String(msg || "").replace(/\s+/g, " ").slice(0, 240);
  const isRate = /429|限流|rate.?limit|max open orders/i.test(short);
  // Phoenix/Solana 瞬时拒单：压缩文案 + 长去重，避免 Simulation 长日志每 2 分钟刷一次
  const isSoftPhoenix =
    venue === "phoenix" &&
    /place_order|MatchingEngine|Simulation failed|block height|tx 过期|穿价|CU 不足/i.test(
      short
    );
  const text = isSoftPhoenix
    ? `⚠️ [${venueLabel(venue)}] 补单暂拒（穿价/链上瞬时），下轮自动重试`
    : `⚠️ [${venueLabel(venue)}] ${short}`;
  await tgSend(text, {
    key: `err:${venue}:${isRate ? "rate" : isSoftPhoenix ? "soft-place" : short.slice(0, 80)}`,
    ttlMs: isRate || isSoftPhoenix ? 600_000 : 120_000,
  });
}

export type TradeKind = "开多" | "平多" | "开空" | "平空";

export function classifyTrade(
  posBefore: number,
  side: "buy" | "sell",
  size: number
): { kind: TradeKind; posAfter: number } {
  const eps = 1e-10;
  const sz = Math.abs(size);
  if (side === "buy") {
    if (posBefore < -eps) {
      return { kind: "平空", posAfter: posBefore + sz };
    }
    return { kind: "开多", posAfter: posBefore + sz };
  }
  if (posBefore > eps) {
    return { kind: "平多", posAfter: posBefore - sz };
  }
  return { kind: "开空", posAfter: posBefore - sz };
}

function countBuySell(orders: Array<{ side: string }>): { buy: number; sell: number } {
  let buy = 0;
  let sell = 0;
  for (const o of orders) {
    if (o.side === "buy") buy += 1;
    else sell += 1;
  }
  return { buy, sell };
}

function fmtPosU(pos: number, mid: number): string {
  if (!(mid > 0)) return "-";
  const u = Math.abs(pos) * mid;
  if (u < 1e-6) return "0U";
  return `${u.toFixed(0)}U`;
}

function fmtPnlLabel(pnlUsd: number): string {
  const abs = Math.abs(pnlUsd);
  const n = abs >= 10 ? abs.toFixed(2) : abs.toFixed(4);
  if (pnlUsd < 0) return `亏损 -${n}U`;
  return `盈利 +${n}U`;
}

function tradeLines(p: {
  venue: string;
  action: "开" | "平";
  pnlLabel?: string | null;
  buyOrders: number;
  sellOrders: number;
  posU: string;
}): string {
  const head = p.pnlLabel
    ? `${venueLabel(p.venue)} · ${p.action} · ${p.pnlLabel}`
    : `${venueLabel(p.venue)} · ${p.action}`;
  return [
    head,
    `挂单 多${p.buyOrders} · 空${p.sellOrders}`,
    `仓位 ${p.posU}`,
  ].join("\n");
}

/** 开仓：所 · 开 · 挂单多空 · 仓位U */
export async function tgOpen(p: {
  venue: string;
  kind: "开多" | "开空";
  posAfter: number;
  mid: number;
  openOrders: Array<{ side: string }>;
}): Promise<void> {
  const { buy, sell } = countBuySell(p.openOrders);
  await tgSend(
    tradeLines({
      venue: p.venue,
      action: "开",
      buyOrders: buy,
      sellOrders: sell,
      posU: fmtPosU(p.posAfter, p.mid),
    }),
    {
      key: `open:${p.venue}:${p.kind}:${Math.floor(Date.now() / 8_000)}`,
      ttlMs: 2_000,
    }
  );
}

/** 平仓：所 · 平 · 盈利/亏损 xU · 挂单多空 · 仓位U */
export async function tgClose(p: {
  venue: string;
  kind: "平多" | "平空";
  posAfter: number;
  mid: number;
  openOrders: Array<{ side: string }>;
  /** 单笔盈亏（优先官方 fill；否则格距×size） */
  pnlUsd?: number | null;
}): Promise<void> {
  const { buy, sell } = countBuySell(p.openOrders);
  const pnlLabel =
    p.pnlUsd != null && Number.isFinite(p.pnlUsd)
      ? fmtPnlLabel(p.pnlUsd)
      : "盈利";
  await tgSend(
    tradeLines({
      venue: p.venue,
      action: "平",
      pnlLabel,
      buyOrders: buy,
      sellOrders: sell,
      posU: fmtPosU(p.posAfter, p.mid),
    }),
    {
      key: `close:${p.venue}:${p.kind}:${Math.floor(Date.now() / 8_000)}`,
      ttlMs: 2_000,
    }
  );
}

export async function tgBoot(summary: string): Promise<void> {
  await tgSend(`🚀 经典网格启动\n${summary}`, { key: "boot", ttlMs: 30_000 });
}

/** 整点/日报：只报看板总览 */
export async function tgDailyOverview(p: {
  dayKey: string;
  dayProfit: number | null;
  equity: number | null;
  volume: number | null;
  fees: number | null;
  openOrders: number;
  expectOrders: number;
  healthy: number;
  totalVenues: number;
}): Promise<void> {
  const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}U`;
  const lines = [
    `📊 总览 ${p.dayKey}`,
    `今日盈亏 ${p.dayProfit != null ? signed(p.dayProfit) : "-"}`,
    `总余额 ${p.equity != null && p.equity > 0 ? p.equity.toFixed(0) + "U" : "-"}`,
    `今日成交量 ${p.volume != null ? p.volume.toFixed(0) + "U" : "-"}`,
    `今日手续费 ${p.fees != null ? p.fees.toFixed(2) + "U" : "-"}`,
    `挂单 ${p.openOrders} / 期望≈${p.expectOrders}`,
    `健康 ${p.healthy}/${p.totalVenues}`,
  ];
  await tgSend(lines.join("\n"), {
    key: `daily:${p.dayKey}:${new Date().getHours()}`,
    ttlMs: 50 * 60_000,
  });
}

/** @deprecated 保留别名，内部转总览 */
export async function tgHourlyStatus(p: {
  dayKey: string;
  dayProfit: number | null;
  equity: number | null;
  volume: number | null;
  fees: number | null;
  openOrders: number;
  expectOrders: number;
  healthy: number;
  totalVenues: number;
}): Promise<void> {
  await tgDailyOverview(p);
}
