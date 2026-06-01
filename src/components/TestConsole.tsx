import React, { useState } from "react";
import { Globe, ArrowRight, Gauge, FileCode, Check, Copy } from "lucide-react";
import { TunnelTestResult } from "../types";

interface TestConsoleProps {
  onRunTest: (targetUrl: string) => Promise<TunnelTestResult>;
  isProxyOffline: boolean;
}

const POPULAR_TESTS = [
  { label: "Httpbin JSON", url: "http://httpbin.org/get" },
  { label: "Ip-Api Geo Target", url: "http://ip-api.com/json" },
  { label: "Google API Discovery", url: "https://www.googleapis.com/discovery/v1/apis" },
];

export default function TestConsole({ onRunTest, isProxyOffline }: TestConsoleProps) {
  const [targetUrl, setTargetUrl] = useState("http://httpbin.org/get");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<TunnelTestResult | null>(null);
  const [copiedResponse, setCopiedResponse] = useState(false);

  const handleTestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl.trim() || isProxyOffline) return;

    setIsRunning(true);
    setResult(null);
    try {
      const resp = await onRunTest(targetUrl);
      setResult(resp);
    } catch {
      setResult({
        success: false,
        error: "Direct pipeline execution returned a connection issue on server."
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopy = () => {
    if (result?.responsePreview) {
      navigator.clipboard.writeText(result.responsePreview);
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg backdrop-blur-md" id="test_console">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2 mb-4">
        <Globe className="h-4 w-4 text-teal-400 stroke-[1.8]" />
        Tunnel Diagnostics client
      </h2>

      {isProxyOffline && (
        <div className="mb-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
          ⚠️ The local proxy server is offline. Please start the tunnel network above to route diagnostic traffic.
        </div>
      )}

      {/* Target form inputs */}
      <form onSubmit={handleTestSubmit} className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            disabled={isProxyOffline || isRunning}
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-teal-500 focus:outline-none disabled:opacity-50"
            placeholder="http://example.com"
          />
          <button
            type="submit"
            disabled={isProxyOffline || isRunning || !targetUrl.trim()}
            id="btn_send_test_request"
            className="flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 active:scale-[0.98] disabled:hover:bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isRunning ? "Routing..." : "Route Request"}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Demo Quick links */}
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-[10px] uppercase font-semibold text-slate-500">Quick Targets:</span>
          {POPULAR_TESTS.map((test, idx) => (
            <button
              key={idx}
              type="button"
              disabled={isProxyOffline || isRunning}
              onClick={() => setTargetUrl(test.url)}
              className="rounded bg-slate-850 hover:bg-slate-800 border border-slate-700/50 px-2 py-0.5 text-[10px] text-slate-400 hover:text-white transition-all cursor-pointer"
            >
              {test.label}
            </button>
          ))}
        </div>
      </form>

      {/* Diagnostic Outputs */}
      {(result || isRunning) && (
        <div className="mt-5 border-t border-slate-800/80 pt-4 animate-fadeIn">
          {isRunning ? (
            <div className="flex flex-col items-center justify-center py-6 text-slate-400">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500/20 border-t-teal-400 mb-2"></div>
              <p className="text-xs font-medium font-mono text-teal-400">Tunneling packets through local_proxy {"->"} TLS relay {"->"} destination...</p>
            </div>
          ) : (
            <div>
              {/* Performance Headers Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
                <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/60">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-0.5">Proxy Status</span>
                  <span className={`text-xs font-bold leading-tight ${result?.success ? "text-emerald-400" : "text-rose-400"}`}>
                    {result?.success ? "200 SUCCESS" : "FAILED"}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/60">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-0.5 flex items-center gap-1">
                    <Gauge className="h-2.5 w-2.5" /> Latency
                  </span>
                  <span className="font-mono text-xs font-bold text-white">
                    {result?.latency} ms
                  </span>
                </div>
                <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/60 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-0.5">Payload size</span>
                  <span className="font-mono text-xs font-bold text-white">
                    {result?.success ? `${result.responseSize} Bytes` : "0 B"}
                  </span>
                </div>
              </div>

              {/* Collapsible response body */}
              {result?.success ? (
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                      <FileCode className="h-3.5 w-3.5 text-teal-400" />
                      Response Body Preview
                    </span>
                    <button
                      onClick={handleCopy}
                      className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-900 transition-all text-xs flex items-center gap-1 cursor-pointer"
                      title="Copy response markdown content"
                    >
                      {copiedResponse ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-[11px] text-emerald-400 font-medium">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span className="text-[11px]">Copy Body</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="font-mono text-[11px] text-slate-300 leading-relaxed max-h-52 overflow-y-auto whitespace-pre-wrap select-text p-2 rounded bg-slate-900/60 border border-slate-900">
                    {result.responsePreview}
                  </pre>
                </div>
              ) : (
                <div className="rounded-lg border border-red-500/20 bg-rose-500/5 p-4 text-xs">
                  <p className="font-semibold text-rose-400 mb-1">Tunnel routing crashed with fault:</p>
                  <p className="font-mono text-rose-300 p-2 bg-rose-500/10 rounded">{result?.error}</p>
                </div>
              )}

              {/* Show Debug curl outputs if available */}
              {result?.diagnostics && (
                <div className="mt-3">
                  <details className="group">
                    <summary className="text-[11px] font-semibold text-slate-500 hover:text-slate-300 marker:text-slate-600 cursor-pointer select-none">
                      Inspect Client Connection handshake (cURL stderr trace)
                    </summary>
                    <div className="mt-2 rounded bg-slate-950 p-3 max-h-40 overflow-y-auto border border-slate-800">
                      <pre className="font-mono text-[9px] text-slate-400 whitespace-pre-wrap select-text leading-tight uppercase">
                        {result.diagnostics}
                      </pre>
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
