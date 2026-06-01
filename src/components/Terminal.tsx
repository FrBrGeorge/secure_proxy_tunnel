import { useState, useRef, useEffect } from "react";
import { Terminal as TermIcon, SlidersHorizontal, Trash2, ArrowUpDown, RefreshCw } from "lucide-react";
import { ServiceState } from "../types";

interface TerminalProps {
  proxyState: ServiceState | null;
  relayState: ServiceState | null;
  onClearLogs: (service: "proxy" | "relay" | "both") => void;
}

export default function Terminal({ proxyState, relayState, onClearLogs }: TerminalProps) {
  const [filterText, setFilterText] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const proxyTerminalRef = useRef<HTMLDivElement>(null);
  const relayTerminalRef = useRef<HTMLDivElement>(null);

  // Trigger auto scroll to bottoms on updates
  useEffect(() => {
    if (autoScroll) {
      if (proxyTerminalRef.current) {
        proxyTerminalRef.current.scrollTop = proxyTerminalRef.current.scrollHeight;
      }
      if (relayTerminalRef.current) {
        relayTerminalRef.current.scrollTop = relayTerminalRef.current.scrollHeight;
      }
    }
  }, [proxyState?.logs, relayState?.logs, autoScroll]);

  // Clean log lines according to simple text matching
  const filterLogs = (logs: string[] | undefined) => {
    if (!logs) return [];
    if (!filterText.trim()) return logs;
    const query = filterText.toLowerCase();
    return logs.filter((line) => line.toLowerCase().includes(query));
  };

  const pLogs = filterLogs(proxyState?.logs);
  const rLogs = filterLogs(relayState?.logs);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg" id="logs_terminal">
      {/* Header controls toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <TermIcon className="h-4 w-4 text-teal-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Real-Time Subprocess Console logs
          </h2>
        </div>

        {/* Inputs and actions row */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="rounded-md border border-slate-800 bg-slate-950 pl-3 pr-8 py-1 text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
              placeholder="Filter logs... (e.g. CONNECT)"
            />
            {filterText && (
              <button
                onClick={() => setFilterText("")}
                className="absolute right-2.5 top-1.5 text-xs text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                ×
              </button>
            )}
          </div>

          {/* Autoscroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
              autoScroll
                ? "bg-slate-800 border-teal-500/30 text-teal-400"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
            }`}
          >
            <ArrowUpDown className="h-3 w-3" />
            <span>{autoScroll ? "Scroll Lock: ON" : "Scroll Lock: OFF"}</span>
          </button>

          {/* Clear Actions */}
          <button
            onClick={() => onClearLogs("both")}
            id="btn_clear_all_logs"
            className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-850 px-3 py-1 text-xs text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
            title="Wipe Logs from Buffer"
          >
            <Trash2 className="h-3 w-3" />
            Clear Screens
          </button>
        </div>
      </div>

      {/* Split Terminal Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* local_proxy console */}
        <div className="flex flex-col rounded-lg border border-slate-800/80 bg-slate-950/90 shadow-inner">
          <div className="flex items-center justify-between border-b border-slate-900 bg-slate-900/50 px-4 py-2 font-mono text-[10px] text-slate-400 font-bold tracking-wide uppercase">
            <span>💻 securetunnel-local (HTTP Proxy)</span>
            {proxyState?.status === "running" ? (
              <span className="flex items-center gap-1 text-emerald-400 text-[9px] animate-pulse">● LIVE</span>
            ) : (
              <span className="text-slate-600 text-[9px]">● OFFLINE</span>
            )}
          </div>
          <div
            ref={proxyTerminalRef}
            className="h-72 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-slate-300 select-text max-w-full scroll-smooth"
          >
            {pLogs.length === 0 ? (
              <div className="text-slate-600 italic font-medium">No system log outputs buffered. Start the proxy server above to prompt feedback.</div>
            ) : (
              pLogs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap select-text mb-1 border-l-2 border-transparent hover:border-teal-500/35 px-1.5 transition-all">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* remote_relay console */}
        <div className="flex flex-col rounded-lg border border-slate-800/80 bg-slate-950/90 shadow-inner">
          <div className="flex items-center justify-between border-b border-slate-900 bg-slate-900/50 px-4 py-2 font-mono text-[10px] text-slate-400 font-bold tracking-wide uppercase">
            <span>🛡️ securetunnel-relay (TCP TLS Relay)</span>
            {relayState?.status === "running" ? (
              <span className="flex items-center gap-1 text-teal-400 text-[9px] animate-pulse">● LIVE</span>
            ) : (
              <span className="text-slate-600 text-[9px]">● OFFLINE</span>
            )}
          </div>
          <div
            ref={relayTerminalRef}
            className="h-72 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-slate-300 select-text max-w-full scroll-smooth"
          >
            {rLogs.length === 0 ? (
              <div className="text-slate-600 italic font-medium">No tunnel secure logs buffered. Start the relay server above to prompt feedback.</div>
            ) : (
              rLogs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap select-text mb-1 border-l-2 border-transparent hover:border-indigo-500/35 px-1.5 transition-all">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
