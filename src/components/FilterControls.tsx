"use client";

// The board's filters beyond region and role: pay range and how sure the figure is, publication
// dates, and the choice filters ("More filters"), with the active ones listed above the table.

import { X } from "lucide-react";
import { ROLE_LABEL, ROLES } from "@/lib/constants";
import { FACETS, payActive, pubActive, type ChipFacet, type Filters } from "@/lib/filters";
import { shortDate } from "@/lib/format";

type Set = (patch: Partial<Filters>) => void;
type Counts = Record<ChipFacet, Record<string, number>>;

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** A choice filter: any number of its options (none = all), each with how many offers it would show. */
export function ChoiceChips({ facet, f, set, counts, label }: { facet: ChipFacet; f: Filters; set: Set; counts: Counts; label?: string }) {
  const { options } = FACETS[facet];
  const chosen = f[facet] as string[];
  const toggle = (k: string) => {
    const next = chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k];
    // Every option ticked is the same as none
    set({ [facet]: next.length === options.length ? [] : next } as Partial<Filters>);
  };
  return (
    <fieldset className="facet">
      <legend>
        {label ?? FACETS[facet].label}
        {chosen.length > 0 && (
          <button type="button" className="link-btn facet-clear" onClick={() => set({ [facet]: [] } as Partial<Filters>)}>
            All
          </button>
        )}
      </legend>
      <div className="chips">
        {options.map(([k, l]) => {
          const on = chosen.includes(k);
          const count = counts[facet][k] ?? 0;
          return (
            <button key={k} type="button" className="chip" aria-pressed={on} data-zero={(!on && count === 0) || undefined} onClick={() => toggle(k)}>
              {l}
              <span className="chip-n">{n(count)}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------- pay

const PAY_PRESETS = { year: [30, 50, 80, 120], month: [2, 3, 5, 8] } as const;
const UNIT = { year: "€/yr", month: "€/mo" } as const;

/** "≥ 50k €/yr", "30–80k €/yr", "≤ 3.5k €/mo" */
export function payLabel(f: Filters): string {
  const u = UNIT[f.payUnit];
  if (f.payMin != null && f.payMax != null) return `${n(f.payMin)}–${n(f.payMax)}k ${u}`;
  if (f.payMin != null) return `≥ ${n(f.payMin)}k ${u}`;
  if (f.payMax != null) return `≤ ${n(f.payMax)}k ${u}`;
  return "";
}

/** Thousands of € a year ⇄ a month, rounded to what the inputs step by */
const convert = (v: number | null, to: Filters["payUnit"]) => (v == null ? null : to === "month" ? Math.round((v / 12) * 2) / 2 : Math.round(v * 12));

export function PayPanel({ f, set, counts }: { f: Filters; set: Set; counts: Counts }) {
  const unit = f.payUnit;
  const step = unit === "year" ? 5 : 0.5;
  const value = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));
  return (
    <div className="fpanel fpanel-pay">
      <fieldset className="facet">
        <legend>
          Pay range
          {payActive(f) && (
            <button type="button" className="link-btn facet-clear" onClick={() => set({ payMin: null, payMax: null })}>
              Any
            </button>
          )}
        </legend>
        <div className="seg seg-keep seg-sm" role="radiogroup" aria-label="Unit">
          {(["year", "month"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => u !== unit && set({ payUnit: u, payMin: convert(f.payMin, u), payMax: convert(f.payMax, u) })}
            >
              {u === "year" ? "Per year" : "Per month"}
            </button>
          ))}
        </div>
        <div className="range">
          <label>
            <span>Minimum</span>
            <span className="range-input">
              <input type="number" inputMode="decimal" min={0} step={step} value={f.payMin ?? ""} placeholder="—" onChange={(e) => set({ payMin: value(e.target.value) })} />
              k {UNIT[unit]}
            </span>
          </label>
          <label>
            <span>Maximum</span>
            <span className="range-input">
              <input type="number" inputMode="decimal" min={0} step={step} value={f.payMax ?? ""} placeholder="—" onChange={(e) => set({ payMax: value(e.target.value) })} />
              k {UNIT[unit]}
            </span>
          </label>
        </div>
        <div className="chips">
          {PAY_PRESETS[unit].map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={f.payMin === p && f.payMax == null} onClick={() => set({ payMin: p, payMax: null })}>
              ≥ {n(p)}k
            </button>
          ))}
        </div>
        <p className="facet-hint">In € (other currencies converted). Internships count their monthly pay; per year, × 12. Any offer whose range overlaps yours is in.</p>
      </fieldset>
      <ChoiceChips facet="paySrc" f={f} set={set} counts={counts} label="Is the pay confirmed?" />
    </div>
  );
}

// ---------- publication date

const PUB_PRESETS: [number, string][] = [
  [3, "Last 3 days"],
  [7, "Last week"],
  [30, "Last month"],
  [90, "Last 3 months"],
];

export function pubLabel(f: Filters): string {
  const base = f.pubDays
    ? (PUB_PRESETS.find(([d]) => d === f.pubDays)?.[1] ?? `Last ${f.pubDays} days`)
    : f.pubFrom && f.pubTo
      ? `${shortDate(f.pubFrom)} – ${shortDate(f.pubTo)}`
      : f.pubFrom
        ? `Since ${shortDate(f.pubFrom)}`
        : f.pubTo
          ? `Until ${shortDate(f.pubTo)}`
          : "";
  return base && f.pubUndated ? `${base} (and undated)` : base;
}

export function PubPanel({ f, set, undated, today }: { f: Filters; set: Set; undated: number; today: string }) {
  const active = pubActive(f);
  return (
    <div className="fpanel fpanel-pub">
      <fieldset className="facet">
        <legend>
          Publication date
          {active && (
            <button type="button" className="link-btn facet-clear" onClick={() => set({ pubDays: null, pubFrom: null, pubTo: null })}>
              Any
            </button>
          )}
        </legend>
        <div className="chips">
          {PUB_PRESETS.map(([d, l]) => (
            <button key={d} type="button" className="chip" aria-pressed={f.pubDays === d} onClick={() => set({ pubDays: f.pubDays === d ? null : d, pubFrom: null, pubTo: null })}>
              {l}
            </button>
          ))}
        </div>
        <div className="range">
          <label>
            <span>From</span>
            <input type="date" value={f.pubFrom ?? ""} max={f.pubTo ?? today} onChange={(e) => set({ pubFrom: e.target.value || null, pubDays: null })} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={f.pubTo ?? ""} min={f.pubFrom ?? undefined} max={today} onChange={(e) => set({ pubTo: e.target.value || null, pubDays: null })} />
          </label>
        </div>
        <label className="check" data-disabled={!active || undefined}>
          <input type="checkbox" checked={f.pubUndated} disabled={!active} onChange={(e) => set({ pubUndated: e.target.checked })} />
          <span>
            Include the undated ones <span className="muted">({n(undated)})</span>
          </span>
        </label>
        <p className="facet-hint">When it was published on the company's site or a tracker; never when the crawler found it.</p>
      </fieldset>
    </div>
  );
}

// ---------- "More filters"

const FIT_STEPS: [number, string][] = [
  [1, "Any"],
  [2, "2+"],
  [3, "3+"],
  [4, "4+"],
  [5, "5"],
];

export function MorePanel({ f, set, counts }: { f: Filters; set: Set; counts: Counts }) {
  return (
    <div className="fpanel fpanel-more">
      <div className="fgrid">
        <ChoiceChips facet="statuses" f={f} set={set} counts={counts} />
        <ChoiceChips facet="covers" f={f} set={set} counts={counts} />
        <ChoiceChips facet="cvs" f={f} set={set} counts={counts} />
        <ChoiceChips facet="kinds" f={f} set={set} counts={counts} />
        <ChoiceChips facet="eligs" f={f} set={set} counts={counts} />
        <ChoiceChips facet="tiers" f={f} set={set} counts={counts} />
        <fieldset className="facet">
          <legend>Fit with your CV</legend>
          <div className="chips">
            {FIT_STEPS.map(([v, l]) => (
              <button key={v} type="button" className="chip" aria-pressed={f.fitMin === v} onClick={() => set({ fitMin: v })}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        <ChoiceChips facet="ivs" f={f} set={set} counts={counts} />
      </div>
      <div className="fchecks">
        <label className="check">
          <input type="checkbox" checked={f.lowFit} onChange={(e) => set({ lowFit: e.target.checked })} />
          <span>Show offers that do not fit your CV (fit 1) in "To apply"</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.extra} onChange={(e) => set({ extra: e.target.checked })} />
          <span>Include quant firms not on your list</span>
        </label>
      </div>
    </div>
  );
}

// ---------- active filters, above the table

export interface ActiveFilter {
  id: string;
  label: string;
  clear: Partial<Filters>;
}

/** Every filter in effect, each with what removes it. */
export function activeFilters(f: Filters, locLabel: string | null): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (f.q) out.push({ id: "q", label: `Search: "${f.q}"`, clear: { q: "" } });
  if (locLabel) out.push({ id: "loc", label: locLabel, clear: { loc: "all" } });
  if (f.roles.length !== ROLES.length) out.push({ id: "roles", label: f.roles.map((r) => ROLE_LABEL[r] ?? r).join(", "), clear: { roles: ROLES } });
  if (payActive(f)) out.push({ id: "pay", label: `Pay ${payLabel(f)}`, clear: { payMin: null, payMax: null } });
  if (pubActive(f)) out.push({ id: "pub", label: `Published: ${pubLabel(f).toLowerCase()}`, clear: { pubDays: null, pubFrom: null, pubTo: null } });
  for (const k of Object.keys(FACETS) as ChipFacet[]) {
    const chosen = f[k] as string[];
    if (!chosen.length) continue;
    const names = FACETS[k].options.filter(([o]) => chosen.includes(o)).map(([, l]) => l);
    out.push({ id: k, label: `${FACETS[k].label}: ${names.join(", ")}`, clear: { [k]: [] } as Partial<Filters> });
  }
  if (f.fitMin > 1) out.push({ id: "fit", label: `Fit ${f.fitMin === 5 ? "5" : `≥ ${f.fitMin}`}`, clear: { fitMin: 1 } });
  if (f.lowFit) out.push({ id: "lowFit", label: "With fit 1", clear: { lowFit: false } });
  if (!f.extra) out.push({ id: "extra", label: "Without quant firms off your list", clear: { extra: true } });
  return out;
}

export function ActiveFilterBar({ items, onClear, onClearAll }: { items: ActiveFilter[]; onClear: (patch: Partial<Filters>) => void; onClearAll: () => void }) {
  if (!items.length) return null;
  return (
    <div className="filter-bar" role="group" aria-label="Active filters">
      <span className="sort-bar-label">Filters</span>
      {items.map((it) => (
        <span key={it.id} className="fchip">
          <span className="fchip-label">{it.label}</span>
          <button type="button" className="fchip-x" onClick={() => onClear(it.clear)} aria-label={`Remove the filter ${it.label}`}>
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" className="link-btn" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
