"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, CrawlRun } from "@/lib/types";

interface CrawlStatus {
  running: boolean;
  phase: string;
  progress: { done: number; total: number } | null;
  lastRun: CrawlRun | null;
  error: string | null;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

export default function CrawlControl({
  board,
  lastRun,
  onDone,
  unseen,
  onShowNew,
}: {
  board: Board;
  lastRun: CrawlRun | null;
  onDone: (run: CrawlRun) => void;
  /** New offers you have not looked at yet */
  unseen: number;
  onShowNew: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<CrawlStatus | null>(null);
  const [, tick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedFrom = useRef<string | null>(null);

  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const poll = useCallback(async () => {
    const s: CrawlStatus = await fetch(`/api/crawl?board=${board}`, { cache: "no-store" }).then((r) => r.json());
    setStatus(s);
    if (!s.running) {
      stopPolling();
      if (s.lastRun && s.lastRun.id !== startedFrom.current) {
        router.refresh();
        onDone(s.lastRun);
      }
    }
  }, [onDone, router]);

  // A crawl may already be running (started from another tab or the terminal)
  useEffect(() => {
    fetch(`/api/crawl?board=${board}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((s: CrawlStatus) => {
        setStatus(s);
        if (s.running) {
          startedFrom.current = lastRun?.id ?? null;
          timer.current = setInterval(poll, 1000);
        }
      })
      .catch(() => {});
    const t = setInterval(() => tick((n) => n + 1), 60000);
    return () => {
      clearInterval(t);
      stopPolling();
    };
  }, [poll, lastRun?.id]);

  const start = async () => {
    startedFrom.current = lastRun?.id ?? null;
    const r = await fetch(`/api/crawl?board=${board}`, { method: "POST" });
    if (r.ok || r.status === 409) {
      setStatus((s) => ({ ...(s ?? { lastRun, error: null }), running: true, phase: "Downloading sources", progress: null }) as CrawlStatus);
      stopPolling();
      timer.current = setInterval(poll, 1000);
    }
  };

  const running = status?.running;
  const run = status?.lastRun ?? lastRun;
  const stale = !run || Date.now() - Date.parse(run.startedAt) > 24 * 3600e3;
  const pct = status?.progress && status.progress.total ? Math.round((status.progress.done / status.progress.total) * 100) : null;

  return (
    <div className="crawl">
      <div className="crawl-text" aria-live="polite">
        {running ? (
          <>
            <span>
              {status?.phase}
              {status?.progress ? ` · ${status.progress.done}/${status.progress.total}` : "…"}
            </span>
            <span className="crawl-bar" aria-hidden>
              <i style={pct == null ? undefined : { transform: `scaleX(${pct / 100})` }} data-indeterminate={pct == null || undefined} />
            </span>
          </>
        ) : run ? (
          <span className="crawl-last">
            <span title={run.sources.map((s) => `${s.name}: ${s.listings}${s.error ? ` (${s.error})` : ""}`).join("\n")}>
              Searched {ago(run.startedAt)}
              {!run.ok && " · failed"}
            </span>
            {unseen > 0 ? (
              <button type="button" className="new-link" onClick={onShowNew}>
                {unseen} new unseen
              </button>
            ) : (
              <span> · nothing new unseen</span>
            )}
          </span>
        ) : (
          <span>Never searched</span>
        )}
      </div>
      <button type="button" className={`btn ${stale && !running ? "btn-primary" : ""}`} onClick={start} disabled={running}>
        <RefreshCw size={15} aria-hidden className={running ? "spin" : undefined} />
        {running ? "Searching…" : "Search offers"}
      </button>
    </div>
  );
}
