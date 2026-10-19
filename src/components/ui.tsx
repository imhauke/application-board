"use client";

// Small shared controls: dropdown panel, status select, interest star.

import { BadgeCheck, ChevronDown, RotateCcw, Star, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CompSource } from "@/lib/comp";
import { STATUS_OPTIONS } from "@/lib/constants";
import type { Status } from "@/lib/types";

export function Dropdown({
  label,
  badge,
  children,
  align = "start",
  active = false,
}: {
  label: ReactNode;
  badge?: number;
  children: ReactNode;
  align?: "start" | "end";
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(align);
  const [left, setLeft] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Open towards the side that has room; on a narrow screen, slide it back inside the window
  useLayoutEffect(() => {
    if (!open || !panel.current || !ref.current) return;
    const btn = ref.current.getBoundingClientRect();
    const w = panel.current.offsetWidth;
    const s = align === "start" && btn.left + w > window.innerWidth - 8 ? "end" : align === "end" && btn.right - w < 8 ? "start" : align;
    setSide(s);
    const at = s === "start" ? btn.left : btn.right - w;
    const fit = Math.min(Math.max(at, 8), window.innerWidth - 8 - w);
    setLeft(fit !== at ? fit - btn.left : null);
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button type="button" className="ctl" data-active={active || undefined} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ctl-label">{label}</span>
        {badge ? <span className="ctl-badge">{badge}</span> : null}
        <ChevronDown size={14} aria-hidden className="ctl-chev" />
      </button>
      {open && (
        <div ref={panel} className={`dd-panel dd-${side}`} style={left != null ? { left, right: "auto" } : undefined}>
          {children}
        </div>
      )}
    </div>
  );
}

export function StatusSelect({
  value,
  onChange,
  label,
  size = "sm",
}: {
  value: Status;
  onChange: (s: Status) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <select
      className={`status status-${size}`}
      data-v={value || "none"}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as Status)}
      onClick={(e) => e.stopPropagation()}
    >
      {STATUS_OPTIONS.map(([v, l]) => (
        <option key={v} value={v}>
          {v ? l : "Not started"}
        </option>
      ))}
    </select>
  );
}

export function StarButton({ on, onToggle, label, withText = false }: { on: boolean; onToggle: () => void; label: string; withText?: boolean }) {
  return (
    <button
      type="button"
      className={withText ? "btn star-btn" : "star"}
      aria-pressed={on}
      aria-label={withText ? undefined : `${on ? "Unstar" : "Star"}: ${label}`}
      title={on ? "Remove the star" : "Star it"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Star size={withText ? 16 : 17} aria-hidden fill={on ? "currentColor" : "none"} strokeWidth={1.8} />
      {withText && (on ? "Starred" : "Star")}
    </button>
  );
}

export function Dots({ n, label }: { n: number; label: string }) {
  return (
    <span className="dots" role="img" aria-label={`${label} ${n} of 5`} title={`${label} ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} data-on={i <= n || undefined} />
      ))}
    </span>
  );
}

export interface ToastMsg {
  text: string;
  action?: { label: string; onClick: () => void };
}

export function useToast() {
  const [toast, setToastState] = useState<ToastMsg | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToastState(null), toast.action ? 7000 : 4200);
    return () => clearTimeout(t);
  }, [toast]);
  const setToast = (msg: string | ToastMsg | null) => setToastState(typeof msg === "string" ? { text: msg } : msg);
  const node = toast ? (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.onClick();
            setToastState(null);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  ) : null;
  return [node, setToast] as const;
}

/** Moves an offer to the trash after a second, explicit confirmation. */
export function TrashButton({ label, onConfirm, withText = false }: { label: string; onConfirm: () => void; withText?: boolean }) {
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!asking) return;
    const cancel = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAsking(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAsking(false);
    };
    const t = setTimeout(() => setAsking(false), 6000);
    document.addEventListener("mousedown", cancel);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", cancel);
      document.removeEventListener("keydown", onKey);
    };
  }, [asking]);
  return (
    <div className={`trash${withText ? " trash-inline" : ""}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={withText ? "btn btn-quiet" : "icon-btn trash-btn"}
        aria-label={withText ? undefined : `Move to the trash: ${label}`}
        title="Move to the trash"
        aria-expanded={asking}
        onClick={() => setAsking((a) => !a)}
      >
        <Trash2 size={withText ? 15 : 16} aria-hidden />
        {withText && "Trash"}
      </button>
      {asking && (
        <div className={`trash-confirm${withText ? " trash-confirm-inline" : ""}`} role="alertdialog" aria-label="Confirm">
          <span>Move to the trash?</span>
          <button
            type="button"
            className="btn btn-danger btn-xs"
            autoFocus
            onClick={() => {
              setAsking(false);
              onConfirm();
            }}
          >
            Yes, move
          </button>
          <button type="button" className="btn btn-xs" onClick={() => setAsking(false)}>
            No
          </button>
        </div>
      )}
    </div>
  );
}

export function RestoreButton({ label, onRestore, withText = false }: { label: string; onRestore: () => void; withText?: boolean }) {
  return (
    <button
      type="button"
      className={withText ? "btn" : "icon-btn restore-btn"}
      aria-label={withText ? undefined : `Restore: ${label}`}
      title="Take out of the trash"
      onClick={(e) => {
        e.stopPropagation();
        onRestore();
      }}
    >
      <RotateCcw size={withText ? 15 : 16} aria-hidden />
      {withText && "Restore"}
    </button>
  );
}

const PAY_BADGE: Record<CompSource, { text: string; title: string }> = {
  posted: { text: "Official", title: "Salary published in the posting itself" },
  tracker: { text: "Tracker", title: "Figure published by the tracker (Simplify…), not by the posting: it may include bonus" },
  estimate: { text: "Approx.", title: "Approximate: the posting publishes no salary. Estimated from the company's pay level, the city and the type of role" },
};

/** Where a pay figure comes from: the posting itself, a tracker, or an estimate. */
export function PayBadge({ source }: { source: CompSource }) {
  const b = PAY_BADGE[source];
  return (
    <span className={`pay-src pay-src-${source}`} title={b.title}>
      {source === "posted" && <BadgeCheck size={12} aria-hidden />}
      {b.text}
    </span>
  );
}
