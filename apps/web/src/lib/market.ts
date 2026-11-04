/**
 * What a trade's standard items typically cost (anonymous market rates), from OpenWorks'
 * collector: only items at least five different businesses have shared, as the middle half of
 * what they charged over the last 12 months. Kept on the phone for a day, so it works offline.
 */
import type { MarketRange } from '@shap/shared';
import { COLLECTOR } from './usage';

const KEY = 'shap.marketRates:';
const DAY = 24 * 3600_000;

export async function marketRanges(industry: string): Promise<MarketRange[]> {
  if (!industry) return [];
  let kept: { at: number; items: MarketRange[] } | null = null;
  try {
    kept = JSON.parse(localStorage.getItem(KEY + industry) ?? 'null');
  } catch {
    kept = null;
  }
  if (kept && Date.now() - kept.at < DAY) return kept.items;
  try {
    const r = await fetch(`${COLLECTOR}/market/rates?industry=${encodeURIComponent(industry)}`);
    if (!r.ok) return kept?.items ?? [];
    const items = ((await r.json()) as { items: MarketRange[] }).items;
    try {
      localStorage.setItem(KEY + industry, JSON.stringify({ at: Date.now(), items }));
    } catch {
      /* fine */
    }
    return items;
  } catch {
    return kept?.items ?? [];
  }
}
