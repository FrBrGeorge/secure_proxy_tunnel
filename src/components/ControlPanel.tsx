import { Play, Square, RotateCw, Settings, PortSignaling } from "lucide-react";
import { useState } from "react";
import { ProxySystemStatus } from "../types";

interface ControlPanelProps {
  status: ProxySystemStatus | null;
  onControlAction: (action: string, service: string, customProxy?: number, customRelay?: number) => void;
  isProcessing: boolean;
}

export default function ControlPanel({ status, onControlAction, isProcessing }: ControlPanelProps) {
  const [proxyPort, setProxyPort] = useState<number>(status?.proxy.port || 19088);
  const [relayPort, setRelayPort] = useState<number>(status?.relay.port || 19099);
  const [showConfig, setShowConfig] = useState(false);

  const proxyOnline = status?.proxy.status === "running";
  const relayOnline = status?.relay.status === "running";

  const handleRestart = () => {
    onControlAction("restart", "both", proxyPort, relayPort);
  };

  const handleStop = () => {
    onControlAction("stop", "both");
  };

  const handleStart = () => {
    onControlAction("start", "both", proxyPort, relayPort);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg backdrop-blur-md" id="control_panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Settings className="h-4 w-4 text-teal-400 stroke-[1.8]" />
          Tunnel Engine Control
        </h2>
        <button
          onClick={() => setShowConfig(!showConfig)}
          id="btn_toggle_config"
          className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
        >
          {showConfig ? "Hide Config" : "Configure Ports"}
        </button>
      </div>

      {showConfig && (
        <div className="mb-5 grid grid-cols-2 gap-4 rounded-lg border border-slate-800/80 bg-slate-950/60 p-4 animate-fadeIn">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Local Proxy HTTP Port
            </label>
            <input
              type="number"
              value={proxyPort}
              onChange={(e) => setProxyPort(parseInt(e.target.value) || 19088)}
              className="w-full rounded border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white focus:border-teal-500 focus:outline-none"
              placeholder="19088"
              disabled={proxyOnline}
            />
            {proxyOnline && (
              <span className="text-[10px] text-yellow-500 mt-1 block">Stop proxy to edit port</span>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Remote Relay TLS Port
            </label>
            <input
              type="number"
              value={relayPort}
              onChange={(e) => setRelayPort(parseInt(e.target.value) || 19099)}
              className="w-full rounded border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white focus:border-teal-500 focus:outline-none"
              placeholder="19099"
              disabled={relayOnline}
            />
            {relayOnline && (
              <span className="text-[10px] text-yellow-500 mt-1 block">Stop relay to edit port</span>
            )}
          </div>
        </div>
      )}

      {/* Main Actions layout */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {(!proxyOnline || !relayOnline) ? (
          <button
            onClick={handleStart}
            disabled={isProcessing}
            id="btn_start_tunnels"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] hover:shadow-[0_0_15px_rgba(16,185,129,0.2)] px-4 py-2.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
          >
            <Play className="h-4 w-4 fill-white" />
            Start Tunnel Network
          </button>
        ) : (
          <button
            onClick={handleStop}
            disabled={isProcessing}
            id="btn_stop_tunnels"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-500 active:scale-[0.99] hover:shadow-[0_0_15px_rgba(239,68,68,0.2)] px-4 py-2.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
          >
            <Square className="h-4 w-4 fill-white" />
            Shut Down Network
          </button>
        )}

        <button
          onClick={handleRestart}
          disabled={isProcessing}
          id="btn_restart_tunnels"
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all active:scale-[0.99] px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
        >
          <RotateCw className={`h-4 w-4 ${isProcessing ? 'animate-spin' : ''}`} />
          Restart Subprocesses
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${proxyOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
          Proxy Subsystem: {status?.proxy.status?.toUpperCase() || "OFFLINE"}
        </span>
        <span className="text-slate-700">•</span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${relayOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
          Relay Subsystem: {status?.relay.status?.toUpperCase() || "OFFLINE"}
        </span>
      </div>
    </div>
  );
}
