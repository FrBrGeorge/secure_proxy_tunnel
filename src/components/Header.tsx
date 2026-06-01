import { Shield, Download, RefreshCw, Server, Cpu } from "lucide-react";
import { ProxySystemStatus } from "../types";

interface HeaderProps {
  status: ProxySystemStatus | null;
  onRefresh: () => void;
  isDownloading: boolean;
  onDownload: () => void;
}

export default function Header({ status, onRefresh, isDownloading, onDownload }: HeaderProps) {
  const proxyOnline = status?.proxy.status === "running";
  const relayOnline = status?.relay.status === "running";

  return (
    <header className="border-b border-slate-850 bg-slate-900 px-6 py-4" id="app_header">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        {/* Left Side: Brand & Iconography */}
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-teal-500/10 p-2 text-teal-400 border border-teal-500/20">
            <Shield className="h-6 w-6 stroke-[1.8]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Secure Proxy Tunnel
              <span className="font-mono text-[10px] font-normal tracking-wider uppercase bg-teal-500/15 border border-teal-500/20 px-1.5 py-0.5 rounded text-teal-400">
                STABLE
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Secure TCP connection forwarding via high-performance python asyncio
            </p>
          </div>
        </div>

        {/* Right Side: Status Indicators & Download */}
        <div className="flex flex-wrap items-center gap-3 sm:self-center">
          {/* Status Badge: Proxy */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
            <Cpu className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs font-medium text-slate-300">Local Proxy:</span>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${proxyOnline ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-rose-500'}`} />
              <span className="font-mono text-xs font-semibold text-white">
                {proxyOnline ? `Port ${status?.proxy.port}` : "Offline"}
              </span>
            </div>
          </div>

          {/* Status Badge: Relay */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
            <Server className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs font-medium text-slate-300">Secure Relay:</span>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${relayOnline ? 'bg-teal-400 shadow-[0_0_8px_#2dd4bf]' : 'bg-rose-500'}`} />
              <span className="font-mono text-xs font-semibold text-white">
                {relayOnline ? `Port ${status?.relay.port}` : "Offline"}
              </span>
            </div>
          </div>

          {/* Reset / Manual Sync */}
          <button
            onClick={onRefresh}
            id="btn_refresh_status"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 transition-all hover:bg-slate-800 hover:border-slate-700 text-slate-300 hover:text-white"
            title="Refresh Status Diagnostics"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          {/* ZIP Package Exporter */}
          <button
            onClick={onDownload}
            disabled={isDownloading}
            id="btn_download_zip"
            className="flex h-9 items-center gap-2 rounded-lg bg-teal-500 px-4 text-xs font-medium text-slate-950 transition-all hover:bg-teal-400 active:scale-[0.98] disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {isDownloading ? "Zipping Package..." : "Download Python Package"}
          </button>
        </div>
      </div>
    </header>
  );
}
