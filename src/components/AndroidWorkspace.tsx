import { useState, useEffect, useRef } from "react";
import { 
  Smartphone, Shield, Info, Save, Play, Square, Wifi, HelpCircle, 
  Settings, Network, CheckCircle2, ChevronRight, Download, Server, Key
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function AndroidWorkspace() {
  // Mobile parameters (persist to simulated SharedPreferences / localStorage)
  const [relayHost, setRelayHost] = useState("10.0.2.2");
  const [relayPort, setRelayPort] = useState(19099);
  const [localPort, setLocalPort] = useState(19088);
  const [paddingAmount, setPaddingAmount] = useState(64);
  const [insecureMode, setInsecureMode] = useState(true); // default true: Insecure mode (Allow Self-Signed TLS)
  const [operationMode, setOperationMode] = useState<"vpn" | "localhost">("localhost");
  
  // App active statuses
  const [apkUrl, setApkUrl] = useState("");
  const [isTunnelActive, setIsTunnelActive] = useState(false);
  const [activeTab, setActiveTab] = useState<"app" | "help" | "diagrams">("app");
  const [logs, setLogs] = useState<string[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Time and Battery mock status
  const [currentTime, setCurrentTime] = useState("12:00 PM");
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load configs on start
  useEffect(() => {
    const savedHost = localStorage.getItem("android_relay_host");
    const savedRelayPort = localStorage.getItem("android_relay_port");
    const savedLocalPort = localStorage.getItem("android_local_port");
    const savedPadding = localStorage.getItem("android_padding_amount");
    const savedInsecure = localStorage.getItem("android_insecure_mode");
    const savedMode = localStorage.getItem("android_operation_mode");

    if (typeof window !== "undefined") {
      setApkUrl(window.location.origin + "/api/proxy/download-apk");
    }

    if (savedHost) setRelayHost(savedHost);
    if (savedRelayPort) setRelayPort(parseInt(savedRelayPort));
    if (savedLocalPort) setLocalPort(parseInt(savedLocalPort));
    if (savedPadding) setPaddingAmount(parseInt(savedPadding));
    if (savedInsecure) setInsecureMode(savedInsecure === "true");
    if (savedMode) setOperationMode(savedMode as "vpn" | "localhost");

    // Dynamic Clock
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateClock();
    const timeInterval = setInterval(updateClock, 60000);
    return () => clearInterval(timeInterval);
  }, []);

  // Save Settings handler
  const handleSaveSettings = () => {
    localStorage.setItem("android_relay_host", relayHost);
    localStorage.setItem("android_relay_port", relayPort.toString());
    localStorage.setItem("android_local_port", localPort.toString());
    localStorage.setItem("android_padding_amount", paddingAmount.toString());
    localStorage.setItem("android_insecure_mode", insecureMode.toString());
    localStorage.setItem("android_operation_mode", operationMode);
    
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);

    // If active, stream configuration updated log
    if (isTunnelActive) {
      addLog(`[SYSTEM] Client configuration updated on-the-fly. Reloading sockets.`);
    }
  };

  const addLog = (text: string) => {
    const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-80), `[${timeStr}] ${text}`]);
  };

  // Simulating Tunnel Connection Events
  const handleToggleTunnel = () => {
    if (isTunnelActive) {
      // Disconnecting
      if (logIntervalRef.current) clearInterval(logIntervalRef.current);
      addLog(`[SYSTEM] Disconnecting active tunnel client...`);
      addLog(`[SYSTEM] ${operationMode === "vpn" ? "VPN Virtual NIC" : "Local ServerSocket listener"} closed successfully.`);
      addLog(`[STATUS] Secure Tunnel Disengaged.`);
      setIsTunnelActive(false);
    } else {
      // Connecting
      setIsTunnelActive(true);
      setLogs([]);
      
      const modeLabel = operationMode === "vpn" ? "VPN Seamless Tunnel" : "Localhost HTTP Proxy";
      addLog(`[START] Initializing Secure Tunnel Client v0.0.3...`);
      addLog(`[CONFIG] Target Remote Relay -> ${relayHost}:${relayPort}`);
      addLog(`[CONFIG] Handshake randomization padding size: ${paddingAmount} bytes.`);
      addLog(`[CONFIG] TLS Verification: ${insecureMode ? "DISABLED (Insecure Mode)" : "ENABLED (Strict Chain Verification)"}`);
      addLog(`[INIT] Engaging routing mode: ${modeLabel}`);

      if (operationMode === "vpn") {
        addLog(`[VPN] Checking Android VpnService permissions... Authorized.`);
        addLog(`[VPN] Allocating virtual TUN interface (MTU=1500, Local=10.8.0.2).`);
        addLog(`[VPN] Intercepting all device-wide TCP and UDP traffic natively.`);
      } else {
        addLog(`[PROXY] Binding ServerSocket on local loopback interface: 127.0.0.1:${localPort}`);
        addLog(`[PROXY] Real localhost listener established. Port configuration updated.`);
      }

      addLog(`[SECURITY] Launching secure TLS socket handshake with Remote Relay...`);
      if (insecureMode) {
        addLog(`[WARNING] Insecure verification engaged. Skipping SSL Trust Chain check.`);
      }

      let step = 0;
      logIntervalRef.current = setInterval(() => {
        step++;
        if (step === 1) {
          addLog(`[TLS] SSL/TLS negotiated successfully. Cipher Suite: TLS_AES_256_GCM_SHA384`);
          addLog(`[HANDSHAKE] Sending secure authentication preamble bytes configuration.`);
          const designPad = Math.floor(Math.random() * paddingAmount * 2);
          addLog(`[PROTOCOL] Header structure padded with ${designPad} randomized noise bytes.`);
        } else if (step === 2) {
          addLog(`[STATUS] Active tunnel established! Connected & ready to relay traffic.`);
        } else {
          // Stream random simulation traffic logs
          const bytesCount = Math.floor(Math.random() * 2000) + 120;
          const isLarge = bytesCount > 1024;
          const labelPrefix = operationMode === "vpn" ? "TUN [Intercepted IP Frame]" : "PROXY [Client 127.0.0.1 request]";
          
          if (isLarge) {
            addLog(`[TRAFFIC] ${labelPrefix}: relayed ${bytesCount} bytes. Oversized (>1024b) -> Padding skipped.`);
          } else {
            const padSize = Math.floor(Math.random() * paddingAmount * 2);
            addLog(`[TRAFFIC] ${labelPrefix}: relayed ${bytesCount} bytes. Padded with ${padSize} randomized noise bytes.`);
          }
        }
      }, 1500);
    }
  };

  // Clean log streams on exit
  useEffect(() => {
    return () => {
      if (logIntervalRef.current) clearInterval(logIntervalRef.current);
    };
  }, [isTunnelActive, operationMode]);

  // Scroll to new logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 md:p-8" id="android_workspace">
      <div className="flex flex-col gap-6 md:flex-row">
        
        {/* Left Side: Mobile Simulator Frame */}
        <div className="w-full md:w-[360px] flex-shrink-0 flex justify-center">
          <div className="relative w-[310px] h-[640px] bg-slate-950 border-[6px] border-slate-800 rounded-[38px] shadow-2xl flex flex-col overflow-hidden ring-4 ring-slate-900/30">
            
            {/* Notch Camera Speaker Area */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-[22px] bg-slate-800 rounded-b-2xl z-50 flex items-center justify-center gap-1.5 px-3">
              <div className="w-3 h-3 bg-slate-900 rounded-full border border-slate-950"></div>
              <div className="w-12 h-1 bg-slate-900 rounded-full"></div>
            </div>

            {/* Screen Top Status Bar */}
            <div className="h-[44px] bg-slate-950 flex items-end justify-between px-6 pb-1 text-[11px] font-semibold text-slate-400 select-none z-40">
              <span>{currentTime}</span>
              <div className="flex items-center gap-1.5">
                <Wifi className="h-3.5 w-3.5 text-teal-400" />
                <span className="text-[9px]">LTE</span>
                <div className="w-5 h-2.5 border border-slate-600 rounded-sm p-[1px] flex items-center">
                  <div className="w-full h-full bg-teal-400 rounded-2xs"></div>
                </div>
              </div>
            </div>

            {/* Simulated UI Content Area */}
            <div className="flex-1 bg-slate-900 flex flex-col overflow-hidden relative text-slate-100">
              
              {/* Virtual App Header */}
              <div className="bg-slate-950 border-b border-slate-800/80 p-3 pt-2 text-center text-xs font-bold text-slate-300 flex items-center justify-between">
                <Smartphone className="h-4 w-4 text-teal-400" />
                <span className="tracking-wide">Secure Tunnel Client</span>
                <button 
                  onClick={() => setActiveTab(activeTab === "help" ? "app" : "help")}
                  className="p-1 hover:bg-slate-800 rounded transition-colors"
                >
                  <HelpCircle className="h-4 w-4 text-slate-400" />
                </button>
              </div>

              {/* Sub tabs: Options, Help, Diagrams */}
              <div className="grid grid-cols-3 border-b border-slate-850 text-[10px] font-bold text-slate-400 uppercase select-none bg-slate-950/40">
                <button 
                  onClick={() => setActiveTab("app")}
                  className={`py-2 pt-2.5 text-center transition-all border-b-2 ${activeTab === "app" ? "text-teal-400 border-teal-500 bg-slate-900/50" : "border-transparent hover:text-slate-300"}`}
                >
                  Tunnel
                </button>
                <button 
                  onClick={() => setActiveTab("help")}
                  className={`py-2 pt-2.5 text-center transition-all border-b-2 ${activeTab === "help" ? "text-teal-400 border-teal-500 bg-slate-900/50" : "border-transparent hover:text-slate-300"}`}
                >
                  App Help
                </button>
                <button 
                  onClick={() => setActiveTab("diagrams")}
                  className={`py-2 pt-2.5 text-center transition-all border-b-2 ${activeTab === "diagrams" ? "text-teal-400 border-teal-500 bg-slate-900/50" : "border-transparent hover:text-slate-300"}`}
                >
                  Topology
                </button>
              </div>

              {/* VIEWPORTS */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col">
                <AnimatePresence mode="wait">
                  
                  {/* APP TAB */}
                  {activeTab === "app" && (
                    <motion.div
                      key="app_view"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex-1 flex flex-col space-y-4"
                    >
                      {/* Connection Stage */}
                      <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-2.5 w-2.5 rounded-full ${isTunnelActive ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`}></div>
                          <div className="text-left">
                            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Status</div>
                            <div className="text-[11px] font-bold text-slate-300">
                              {isTunnelActive ? "Running / Connected" : "Tunnel Stopped"}
                            </div>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/15 uppercase font-bold">
                          v0.0.3
                        </span>
                      </div>

                      {/* Connect Button */}
                      <button
                        onClick={handleToggleTunnel}
                        className={`w-full py-3 px-4 rounded-lg font-bold text-xs tracking-medium uppercase shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                          isTunnelActive 
                            ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/20" 
                            : "bg-teal-500 hover:bg-teal-400 text-slate-950 shadow-teal-950/20"
                        }`}
                      >
                        {isTunnelActive ? (
                          <>
                            <Square className="h-3.5 w-3.5 fill-current" /> Stop Tunnel Client
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 fill-current" /> ENGAGE CONNECT
                          </>
                        )}
                      </button>

                      {/* Config Options Selection (Disabled when running) */}
                      <div className="space-y-3 bg-slate-950/30 p-3 rounded-lg border border-slate-850">
                        <div className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-850">
                          <Settings className="h-3.5 w-3.5 text-slate-500" />
                          <span>Client Settings</span>
                        </div>

                        {/* Relay Address */}
                        <div>
                          <label className="text-[9px] uppercase font-semibold text-slate-500 block mb-1">Remote Relay Host IP</label>
                          <input 
                            type="text" 
                            disabled={isTunnelActive}
                            value={relayHost}
                            onChange={(e) => setRelayHost(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-300 font-mono disabled:opacity-50 focus:outline-none focus:border-teal-500"
                          />
                        </div>

                        {/* Ports Line */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] uppercase font-semibold text-slate-500 block mb-1">Relay Port</label>
                            <input 
                              type="number" 
                              disabled={isTunnelActive}
                              value={relayPort}
                              onChange={(e) => setRelayPort(parseInt(e.target.value) || 19099)}
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-300 font-mono disabled:opacity-50 focus:outline-none focus:border-teal-500"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] uppercase font-semibold text-slate-500 block mb-1">Local Proxy Port</label>
                            <input 
                              type="number" 
                              disabled={isTunnelActive}
                              value={localPort}
                              onChange={(e) => setLocalPort(parseInt(e.target.value) || 19088)}
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-400 font-mono disabled:opacity-50 focus:outline-none focus:border-teal-500"
                            />
                          </div>
                        </div>

                        {/* Padding size Selection */}
                        <div>
                          <label className="text-[9px] uppercase font-semibold text-slate-500 block mb-1">Handshake Padding ({paddingAmount} bytes)</label>
                          <input 
                            type="range" 
                            min="0" 
                            max="256" 
                            step="16"
                            disabled={isTunnelActive}
                            value={paddingAmount}
                            onChange={(e) => setPaddingAmount(parseInt(e.target.value))}
                            className="w-full accent-teal-500 cursor-pointer disabled:opacity-50"
                          />
                        </div>

                        {/* Checkbox for verification bypass (default true) */}
                        <label className="flex items-center gap-2 cursor-pointer pt-1 select-none">
                          <input 
                            type="checkbox" 
                            disabled={isTunnelActive}
                            checked={insecureMode}
                            onChange={(e) => setInsecureMode(e.target.checked)}
                            className="rounded border-slate-800 bg-slate-950 text-teal-400 focus:ring-0 focus:ring-offset-0 disabled:opacity-50"
                          />
                          <div className="text-left leading-normal">
                            <span className="text-[10px] font-semibold text-slate-300 block">Insecure mode (Self-signed certificates allowed)</span>
                            <span className="text-[8px] text-teal-400/90 block">Allows TLS skips verification tests (Default: True)</span>
                          </div>
                        </label>

                        {/* Option Mode Selection */}
                        <div>
                          <label className="text-[9px] uppercase font-semibold text-slate-500 block mb-1.5">Proxy Capture Mode</label>
                          <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded border border-slate-800">
                            <button
                              disabled={isTunnelActive}
                              onClick={() => setOperationMode("localhost")}
                              className={`py-1 text-[9px] font-bold rounded uppercase tracking-wide transition-all ${operationMode === "localhost" ? "bg-teal-500 text-slate-950" : "text-slate-400 hover:text-slate-200"}`}
                            >
                              Local Proxy 
                            </button>
                            <button
                              disabled={isTunnelActive}
                              onClick={() => setOperationMode("vpn")}
                              className={`py-1 text-[9px] font-bold rounded uppercase tracking-wide transition-all ${operationMode === "vpn" ? "bg-teal-500 text-slate-950" : "text-slate-400 hover:text-slate-200"}`}
                            >
                              Android VPN
                            </button>
                          </div>
                        </div>

                        {/* Save Trigger Button */}
                        <button
                          onClick={handleSaveSettings}
                          className="w-full py-1.5 bg-slate-850 hover:bg-slate-800 text-[10px] font-bold text-slate-300 rounded border border-slate-800 transition-all flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Save className="h-3.5 w-3.5 text-teal-400" />
                          {saveSuccess ? "Configuration Saved!" : "Save Settings (SharedPreferences)"}
                        </button>
                      </div>

                      {/* Log Area */}
                      <div className="flex-1 flex flex-col min-h-[140px] bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden">
                        <div className="px-3 py-1 bg-slate-950 flex items-center justify-between border-b border-slate-850">
                          <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-500">Android Logcat Console</span>
                          <span className="text-[8px] uppercase tracking-wider font-mono text-teal-500 bg-teal-500/5 px-2 rounded">
                            {isTunnelActive ? "Engaged" : "Sleeping"}
                          </span>
                        </div>
                        <div 
                          ref={logContainerRef}
                          className="flex-1 overflow-y-auto p-2.5 font-mono text-[9px] text-teal-300/90 space-y-1 text-left leading-relaxed select-text"
                        >
                          {logs.length === 0 ? (
                            <p className="text-slate-600 italic">No logs. Engaged connection to initialize mock logstreams.</p>
                          ) : (
                            logs.map((log, idx) => (
                              <div key={idx} className="whitespace-pre-wrap border-b border-slate-950/20 pb-0.5">{log}</div>
                            ))
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* HELP TAB */}
                  {activeTab === "help" && (
                    <motion.div
                      key="help_view"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex-1 flex flex-col text-left space-y-4"
                    >
                      <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-850 leading-relaxed text-slate-350">
                        <h4 className="text-xs font-bold text-teal-400 border-b border-slate-800 pb-1.5 flex items-center gap-1">
                          <Info className="h-3.5 w-3.5" /> Secure Tunnel Guide
                        </h4>
                        
                        <div className="text-[10px] space-y-3 mt-3 overflow-y-auto max-h-[350px] pr-1 scrollbar-thin">
                          <div>
                            <strong className="text-slate-200 block text-[11px] mb-0.5">💡 What is Secure Tunnel?</strong>
                            Secure Tunnel encrypts and routes your connection through a remote server. This lets you browse privately and access blocked websites/apps.
                          </div>

                          <div>
                            <strong className="text-slate-200 block text-[11px] mb-0.5">🚀 Option A: Android VPN Mode (Recommended)</strong>
                            Intercepts the entire system traffic. Set Capture Mode to <b>Android VPN</b>, enter the Server IP/Port, tap <b>Connect Tunnel</b>, and authorize permissions when prompted.
                          </div>

                          <div>
                            <strong className="text-slate-200 block text-[11px] mb-0.5">⚙️ Option B: Localhost Proxy Mode</strong>
                            Set Capture Mode to <b>Local Proxy</b>, tap <b>Connect</b>, then configure specific apps (browsers, Telegram, Wi-Fi) to route via:<br/>
                            <span className="text-[9px] text-teal-400 font-mono block mt-0.5 pl-2">• IP: 127.0.0.1 • Port: {localPort}</span>
                          </div>

                          <div>
                            <strong className="text-slate-200 block text-[11px] mb-0.5">🔒 Insecure Mode</strong>
                            Keep <b>checked</b> if using a self-signed development certificate (bypasses check). Uncheck for verified production servers.
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* DIAGRAMS TAB */}
                  {activeTab === "diagrams" && (
                    <motion.div
                      key="diagrams_view"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex-1 flex flex-col text-left space-y-3"
                    >
                      <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-850">
                        <h4 className="text-xs font-bold text-teal-400 border-b border-slate-900 pb-1 flex items-center gap-1 mb-2.5">
                          <Network className="h-3.5 w-3.5" /> Traffic Routing Diagram
                        </h4>

                        {operationMode === "vpn" ? (
                          <div className="space-y-3">
                            <span className="text-[10px] font-bold text-slate-300 block mb-1">Android VPN Interception Loop:</span>
                            <div className="rounded bg-slate-950 p-2.5 font-mono text-[9px] text-teal-400 border border-slate-900 space-y-1.5 leading-relaxed">
                              <div>1. Applications dispatch HTTP requests</div>
                              <div className="text-slate-500 pl-4">➔ Internet Packet generated</div>
                              <div>2. Android System intercepts Packets</div>
                              <div className="text-slate-500 pl-4">➔ Redirected to VpnService TUN</div>
                              <div>3. Tunnel reads RAW payload, applies Padding</div>
                              <div className="text-slate-500 pl-4">➔ Encloses with SSL/TLS header</div>
                              <div>4. Dispatched securely to Remote Relay</div>
                              <div className="text-teal-500/80 pl-4">➔ Destination reached safely</div>
                            </div>
                            <p className="text-[9px] text-slate-400 leading-normal">
                              The VPN channel acts on network layer. This bypasses the need for individual app configuration settings.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <span className="text-[10px] font-bold text-slate-300 block mb-1">Localhost Proxy Forwarder:</span>
                            <div className="rounded bg-slate-950 p-2.5 font-mono text-[9px] text-teal-450 border border-slate-900 space-y-1.5 leading-relaxed text-teal-400">
                              <div>1. Client App (e.g. Chrome) targets proxy</div>
                              <div className="text-slate-500 pl-4">➔ Host = 127.0.0.1, Port = {localPort}</div>
                              <div>2. In-app proxy socket reads request</div>
                              <div className="text-slate-500 pl-4">➔ ServerSocket accepts stream</div>
                              <div>3. Proxy pipes traffic to SSL socket</div>
                              <div className="text-slate-500 pl-4">➔ Bypasses SSL cert verification</div>
                              <div>4. Relayed encrypted to Remote Server</div>
                              <div className="text-teal-500/80 pl-4">➔ Secure tunnel bridge success</div>
                            </div>
                            <p className="text-[9px] text-slate-400 leading-normal">
                              Runs on application layer. Sockets bind strictly on loopback (127.0.0.1) keeping it secure from external interfaces.
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>

              {/* Back Bar Soft Buttons */}
              <div className="h-[48px] bg-slate-950 border-t border-slate-900/60 flex items-center justify-around px-6 z-40 select-none">
                <button 
                  onClick={() => {
                    if (activeTab !== "app") setActiveTab("app");
                  }}
                  className="p-1 hover:bg-slate-900 rounded"
                >
                  <ChevronRight className="h-5 w-5 text-slate-500 rotate-180" />
                </button>
                <button 
                  onClick={() => setActiveTab("app")}
                  className="w-4 h-4 rounded-full border-2 border-slate-500 active:border-teal-400"
                ></button>
                <button 
                  onClick={() => setIsTunnelActive(false)}
                  className="w-3.5 h-3.5 border-2 border-slate-500 rounded-xs active:border-teal-400"
                ></button>
              </div>

            </div>
          </div>
        </div>

        {/* Right Side: Android Solution Information & CI Documentation */}
        <div className="flex-1 flex flex-col justify-between space-y-6 text-left">
          <div className="space-y-4">
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Smartphone className="h-6 w-6 text-teal-400" />
              Secure Tunnel – Android Client
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              We have compiled a complete native Android application codebase in Kotlin! Inside, we implement the requested operational designs with highly granular client configuration options, persistent configurations, secure randomized handshake padding, and an automated GitHub Actions pipeline.
            </p>

            {/* Architecture Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* VPN Architecture Card */}
              <div className="bg-slate-950/40 p-4 rounded-lg border border-slate-800/80">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-5 w-5 text-teal-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">Mode 1: Seamless VPN Tunnel</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-2">
                  Subclasses Android\'s core native <code className="text-slate-250 font-mono">VpnService</code> to construct a system-wide TUN loopback. Redirects all device-wide TCP/UDP streams through a virtual interface without manual browser updates.
                </p>
                <div className="text-[10px] font-mono text-teal-400 bg-slate-950/80 px-2 py-1 rounded select-text">
                  Class: VpnModeService.kt extends VpnService
                </div>
              </div>

              {/* Localhost Proxy Card */}
              <div className="bg-slate-950/40 p-4 rounded-lg border border-slate-800/80">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="h-5 w-5 text-teal-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">Mode 2: Localhost Proxy API</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-2">
                  Spawns an application-level ServerSocket strictly bound to <code className="text-slate-250 font-mono">127.0.0.1:localPort</code>. It processes incoming connection packets and routes them securely with custom, modular header formatting.
                </p>
                <div className="text-[10px] font-mono text-teal-400 bg-slate-950/80 px-2 py-1 rounded select-text">
                  Class: LocalProxyService.kt listening of ServerSocket
                </div>
              </div>

            </div>

            {/* Features Status checklist */}
            <div className="bg-slate-950/30 p-4 rounded-lg border border-slate-800/65">
              <h4 className="text-xs font-bold text-slate-350 tracking-wider uppercase mb-3 flex items-center gap-1.5 border-b border-slate-850 pb-2">
                <CheckCircle2 className="h-4 w-4 text-teal-400" /> Android Mandates Accomplished
              </h4>

              <ul className="text-xs space-y-2 text-slate-300">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Dual Routing Operation Modes</strong> – Integrated both native client VPN networking and custom HTTP Localhost listeners in standard services.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Fully Configurable Client Options</strong> – Remote Host IP, Tunnel Port, Local Proxy Port, and secure Handshake Padding weights are adjustable.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Persistent Configuration SharedPreferences</strong> – Settings are written to Android\'s XML database, loading on-the-fly automatically.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Default Insecure Certification</strong> – Make insecure mode (allowing bypass of hostname check for development nodes) the system default.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Rich Interactive Help Center</strong> – Added structured in-app instruction guidelines (HTML-rendered in Android dialog components).
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Automated APK build action</strong> – Integrated <code className="text-teal-400 bg-slate-950 px-1 font-mono">android.yml</code> pipeline, executing Gradle tasks to export compilable APK artifacts when files are modified.
                  </div>
                </li>
              </ul>
            </div>
          </div>

          {/* Release APK Download & QR Code Section */}
          <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-5 flex flex-col md:flex-row items-center gap-6" id="release_apk_card">
            <div className="flex-1 text-left space-y-3">
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-teal-400" />
                <h3 className="text-sm font-bold text-slate-200">Download Android App APK</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Scan the QR code with your mobile device or click the button below to download and install the latest compiled client APK direct to your phone.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <a 
                  href="/api/proxy/download-apk" 
                  download="secure-tunnel-android.apk"
                  id="btn_download_apk"
                  className="inline-flex items-center gap-2 py-2 px-4 rounded-lg bg-teal-500 text-slate-950 text-xs font-bold hover:bg-teal-400 shadow-lg shadow-teal-500/10 transition-all select-none cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" /> Download Release APK
                </a>
                <span className="text-[10px] font-mono text-slate-500 self-center">v0.0.3 (SecureTunnelVPN)</span>
              </div>
            </div>
            
            {/* QR Code Graphic Frame */}
            <div className="bg-slate-950 border border-slate-850 p-3.5 rounded-lg flex flex-col items-center gap-1.5 shadow-inner">
              {apkUrl ? (
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&color=2dd4bf&bgcolor=0f172a&data=${encodeURIComponent(apkUrl)}`}
                  alt="Release APK QR Code"
                  referrerPolicy="no-referrer"
                  className="w-28 h-28 rounded shadow border border-slate-800/60"
                />
              ) : (
                <div className="w-28 h-28 rounded bg-slate-900 flex items-center justify-center text-[10px] text-slate-500">Generating...</div>
              )}
              <span className="text-[9px] font-bold text-teal-400 uppercase tracking-widest leading-none mt-1">Scan to Install</span>
            </div>
          </div>

          {/* GitHub Action CI Summary Card */}
          <div className="bg-gradient-to-r from-teal-500/5 to-emerald-500/5 p-4 rounded-lg border border-teal-500/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="text-left space-y-1">
              <div className="text-xs font-bold text-teal-400 flex items-center gap-1.5 uppercase tracking-wide">
                <Key className="h-4 w-4" /> Configured CI/CD Pipeline Artifacts
              </div>
              <p className="text-[11px] text-slate-400 leading-normal max-w-xl">
                When changes are pushed to files located in <code className="text-teal-400 bg-slate-950/60 px-1 rounded font-mono">/android/**</code>, GitHub Actions builds and packages an installable <code className="text-slate-300 font-mono">secure-tunnel-android-debug-apk</code> debug artifact.
              </p>
            </div>
            
            <a 
              href="#code_explorer" 
              onClick={() => {
                const targetBtn = document.getElementById("btn_select_file___github_workflows_android_yml");
                if (targetBtn) targetBtn.click();
              }}
              className="text-[11px] font-bold text-teal-400 bg-teal-500/10 hover:bg-teal-500/20 px-3 py-1.5 rounded border border-teal-500/20 transition-all flex items-center gap-1 cursor-pointer select-none"
            >
              <Download className="h-3 w-3" /> Inspect android.yml
            </a>
          </div>

        </div>

      </div>
    </div>
  );
}
