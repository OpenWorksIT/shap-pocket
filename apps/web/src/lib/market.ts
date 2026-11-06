/**
 * What a trade's standard items typically cost (anonymous market rates), from OpenWorks'
 * collector: only items at least five different businesses have shared, as the middle half of
 * what they charged over the last 12 months. Kept on the phone for a day, so it works offline.
 */
import type { MarketRange } from '@shap/shared';
import { COLLECTOR } from './usage';

const cents = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** Only well-formed ranges are used: a broken reply from the collector mustn't break the editor. */
function wellFormed(v: unknown): MarketRange[] | null {
  const items = (v as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length > 500) return null;
  const ok = items.every((i: Record<string, unknown>) => i && typeof i.item === 'string' && i.item.length <= 120 && typeof i.unit === 'string' && i.unit.length <= 20 && cents(i.lowCents) && cents(i.midCents) && cents(i.highCents) && cents(i.businesses));
  return ok ? (items as MarketRange[]) : null;
}

const KEY = 'shap.marketRates:';
const DAY = 24 * 3600_000;

/** Asked only once the owner has been told about sharing and hasn't switched it off (it says what trade this is). */
export async function marketRanges(industry: string, allowed: boolean): Promise<MarketRange[]> {
  if (!industry || !allowed) return [];
  let kept: { at: number; items: MarketRange[] } | null = null;
  try {
    kept = JSON.parse(localStorage.getItem(KEY + industry) ?? 'null');
  } catch {
    kept = null;
  }
  if (kept && Date.now() - kept.at < DAY && wellFormed(kept)) return kept.items;
  try {
    const r = await fetch(`${COLLECTOR}/market/rates?industry=${encodeURIComponent(industry)}`);
    if (!r.ok) return kept && wellFormed(kept) ? kept.items : [];
    const items = wellFormed(await r.json());
    if (!items) return kept && wellFormed(kept) ? kept.items : [];
    try {
      localStorage.setItem(KEY + industry, JSON.stringify({ at: Date.now(), items }));
    } catch {
      /* fine */
    }
    return items;
  } catch {
    return kept && wellFormed(kept) ? kept.items : [];
  }
}
