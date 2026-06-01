import { useState } from "react";
import { Terminal as TermIcon, CheckCircle2, XCircle, Play, Sparkles, Activity } from "lucide-react";

interface PythonTestRunnerProps {
  onRunPythonTests: () => Promise<any>;
}

export default function PythonTestRunner({ onRunPythonTests }: PythonTestRunnerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    stdout: string;
    stderr: string;
    error?: string;
  } | null>(null);

  const handleRun = async () => {
    setIsRunning(true);
    setTestResult(null);
    try {
      const data = await onRunPythonTests();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        stdout: "",
        stderr: err.message || "Failed to make HTTP call to Python runner endpoint.",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg backdrop-blur-md" id="python_test_runner">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400 stroke-[1.8]" />
          OS Integration Tests
        </h2>
        <span className="font-mono text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-bold">
          Asynchronous
        </span>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed mb-4">
        Validate the complete Python package architecture locally. Runs full-loop server/client integrations including self-signed certificate creation, dynamic port binding, header handshakes, and SSL stream piping.
      </p>

      <button
        onClick={handleRun}
        disabled={isRunning}
        id="btn_run_python_tests"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-all hover:shadow-[0_0_15px_rgba(16,185,129,0.1)] active:scale-[0.98] py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
      >
        <Play className="h-3.5 w-3.5 fill-emerald-400 stroke-none" />
        {isRunning ? "Asserting Integration Handshares..." : "Run Multi-Proxy Integration Tests"}
      </button>

      {/* Result presentation panel */}
      {testResult && (
        <div className="mt-4 animate-fadeIn space-y-3">
          <div className={`p-3 rounded-lg border flex items-center gap-3 ${
            testResult.success 
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
              : "bg-rose-500/10 border-rose-500/20 text-rose-400"
          }`}>
            {testResult.success ? (
              <>
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                <div>
                  <h4 className="text-xs font-bold font-mono">UT-01 & UT-02 SUCCESSFUL</h4>
                  <p className="text-[11px] leading-tight text-emerald-500/80 mt-0.5">TLS Tunnel and GET proxy conduits validated perfectly.</p>
                </div>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 flex-shrink-0" />
                <div>
                  <h4 className="text-xs font-bold font-mono">INTEGRATION FAULT EXCEEDED</h4>
                  <p className="text-[11px] leading-tight text-rose-500/80 mt-0.5">Automated script asserted failure status constraints.</p>
                </div>
              </>
            )}
          </div>

          {/* Test outputs console logs output */}
          <div className="rounded-lg bg-slate-950/80 border border-slate-900 overflow-hidden">
            <div className="bg-slate-900/40 border-b border-slate-900 px-3 py-1.5 flex items-center gap-1.5 justify-between">
              <span className="font-mono text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Standard Unit Error (Output)</span>
              <span className="h-1.5 w-1.5 rounded-full bg-slate-600 animate-pulse"></span>
            </div>
            <pre className="p-3 font-mono text-[10px] text-slate-400 max-h-48 overflow-y-auto whitespace-pre-wrap leading-tight uppercase select-text">
              {testResult.stderr || testResult.stdout || "No logs output transmitted."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
