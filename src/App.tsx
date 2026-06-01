/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Copy, Terminal as TermIcon, FileText, Check, Pocket, Network, AlertTriangle } from "lucide-react";
import { ProxySystemStatus, PackageFiles, TunnelTestResult } from "./types";

import Header from "./components/Header";
import ControlPanel from "./components/ControlPanel";
import TestConsole from "./components/TestConsole";
import CodeViewer from "./components/CodeViewer";
import Terminal from "./components/Terminal";
import PythonTestRunner from "./components/PythonTestRunner";

export default function App() {
  const [status, setStatus] = useState<ProxySystemStatus | null>(null);
  const [files, setFiles] = useState<PackageFiles | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // 1. Poll Status Diagnostics
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/proxy/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error("Failed to poll status metrics:", err);
    }
  };

  // 2. Fetch Codebase indexing
  const fetchFiles = async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch("/api/proxy/files");
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }
    } catch (err) {
      console.error("Failed to fetch proxy resources:", err);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchFiles();

    // Set gentle status poll intervals (every 1.5 seconds)
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  // 3. Trigger Subprocess Actions (start/stop/restart)
  const handleControlAction = async (action: string, service: string, customProxy?: number, customRelay?: number) => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/proxy/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, service, customProxyPort: customProxy, customRelayPort: customRelay })
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error("System control command failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Fire Diagnostic Tunnel Testing Request
  const handleRunTest = async (targetUrl: string): Promise<TunnelTestResult> => {
    const res = await fetch("/api/proxy/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl })
    });
    const data = await res.json();
    // After test, fetch immediate update for logs rendering
    fetchStatus();
    return data;
  };

  // 5. Trigger Package zip download
  const handleDownloadPackage = () => {
    setIsDownloading(true);
    // Directly target endpoints for raw blob delivery
    window.location.href = "/api/proxy/download-zip";
    setTimeout(() => {
      setIsDownloading(false);
    }, 2500);
  };

  // 6. Run Python automated integration tests suite
  const handleRunPythonTests = async () => {
    const res = await fetch("/api/proxy/run-python-tests", {
      method: "POST"
    });
    return await res.json();
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100" id="app_root">
      {/* Complete visual Navbar */}
      <Header
        status={status}
        onRefresh={fetchStatus}
        isDownloading={isDownloading}
        onDownload={handleDownloadPackage}
      />

      {/* Main Core Container */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          
          {/* LEFT PANELS: Setup controls & dynamic requests tester */}
          <section className="space-y-6 lg:col-span-4" id="section_configuration">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <ControlPanel
                status={status}
                onControlAction={handleControlAction}
                isProcessing={isProcessing}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
            >
              <PythonTestRunner
                onRunPythonTests={handleRunPythonTests}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <TestConsole
                onRunTest={handleRunTest}
                isProxyOffline={status?.proxy.status !== "running"}
              />
            </motion.div>

            {/* Micro sandbox architecture description card */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="rounded-xl border border-slate-800/60 bg-slate-900/20 p-5 text-xs text-slate-400"
            >
              <div className="flex items-center gap-2 mb-3 text-slate-300 font-semibold tracking-wider uppercase text-[10px]">
                <Network className="h-4 w-4 text-teal-400" /> Connecting Architecture
              </div>
              <p className="leading-relaxed mb-3">
                This app runs a simulated secure loop-back in your active Cloud Run workspace. When you click 
                <strong className="text-slate-300"> "Route Request"</strong>, it executes a command line curl process targeting our sandboxed HTTP proxy.
              </p>
              <div className="rounded bg-slate-950/60 px-3 py-2 font-mono text-[10px] text-teal-400 border border-slate-900 leading-snug">
                Client (curl) <br />
                ➔ Local Proxy:19088 <br />
                ➔ Secure TLS Tunnel <br />
                ➔ Remote Relay:19099 <br />
                ➔ Target Destination
              </div>
            </motion.div>
          </section>

          {/* RIGHT PANELS: Real-time terminals and filesystem explorers */}
          <section className="space-y-6 lg:col-span-8" id="section_terminal_and_explorer">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <Terminal
                proxyState={status?.proxy || null}
                relayState={status?.relay || null}
                onClearLogs={(serv) => handleControlAction("clear-logs", serv)}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <CodeViewer
                files={files}
                isLoading={loadingFiles}
              />
            </motion.div>
          </section>

        </div>
      </main>

      {/* Footer credits bar */}
      <footer className="mt-12 border-t border-slate-900 py-6 text-center text-xs text-slate-500">
        <p>
          Secure TCP Tunnel & Relay System Package Builder • Built using Python and React TypeScript
        </p>
      </footer>
    </div>
  );
}
