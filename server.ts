import express from "express";
import path from "path";
import { exec, spawn, execSync, ChildProcess } from "child_process";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
app.use(express.json());

const PORT = 3000;

// Locate valid python command
let pythonCmd = "python3";
try {
  execSync("python3 --version");
} catch {
  try {
    execSync("python --version");
    pythonCmd = "python";
  } catch {
    pythonCmd = "python3";
  }
}

// In-Memory Tunnels & Logs State
const DEFAULT_PROXY_PORT = 19088;
const DEFAULT_RELAY_PORT = 19099;

let proxyProcess: ChildProcess | null = null;
let relayProcess: ChildProcess | null = null;

let proxyLogs: string[] = [];
let relayLogs: string[] = [];

let proxyStatus: "running" | "stopped" | "error" = "stopped";
let relayStatus: "running" | "stopped" | "error" = "stopped";

let proxyPort = DEFAULT_PROXY_PORT;
let relayPort = DEFAULT_RELAY_PORT;

function addProxyLog(data: string) {
  const lines = data.split("\n");
  lines.forEach(line => {
    if (line.trim()) {
      proxyLogs.push(line);
    }
  });
  if (proxyLogs.length > 250) {
    proxyLogs = proxyLogs.slice(proxyLogs.length - 250);
  }
}

function addRelayLog(data: string) {
  const lines = data.split("\n");
  lines.forEach(line => {
    if (line.trim()) {
      relayLogs.push(line);
    }
  });
  if (relayLogs.length > 250) {
    relayLogs = relayLogs.slice(relayLogs.length - 250);
  }
}

// Ensure certificate folder is ready in /tmp/
const certPath = "/tmp/securetunnel_cert.pem";
const keyPath = "/tmp/securetunnel_key.pem";

// Helper to kill a child process
function killProcess(proc: ChildProcess | null): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.killed) {
      resolve();
      return;
    }
    
    // Spawn simple signal triggers or try disconnects
    try {
      proc.kill("SIGTERM");
    } catch {}
    
    let isFinished = false;
    const timeout = setTimeout(() => {
      if (!isFinished) {
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve();
      }
    }, 1500);

    proc.on("close", () => {
      clearTimeout(timeout);
      isFinished = true;
      resolve();
    });
    
    proc.on("exit", () => {
      clearTimeout(timeout);
      isFinished = true;
      resolve();
    });
  });
}

function startRelay(): Promise<boolean> {
  return new Promise(async (resolve) => {
    await killProcess(relayProcess);
    
    relayLogs.push(`[System] Starting Relay Server processes... (Configured TLS host binding: localhost:${relayPort})`);
    relayStatus = "running";

    const projectRoot = process.cwd();
    const relayScript = path.join(projectRoot, "secure_tunnel_project", "securetunnel", "remote_relay.py");

    const args = [
      relayScript,
      "--host", "127.0.0.1",
      "--port", relayPort.toString(),
      "--cert", certPath,
      "--key", keyPath
    ];

    try {
      relayProcess = spawn(pythonCmd, args);
      
      relayProcess.stdout?.on("data", (data) => {
        addRelayLog(data.toString());
      });

      relayProcess.stderr?.on("data", (data) => {
        addRelayLog(data.toString());
      });

      relayProcess.on("error", (err) => {
        addRelayLog(`[System Error] Failed to launch relay process: ${err.message}`);
        relayStatus = "error";
      });

      relayProcess.on("exit", (code, signal) => {
        addRelayLog(`[System] Relay process exited with code ${code} (Signal: ${signal})`);
        relayStatus = "stopped";
        relayProcess = null;
      });

      // Give it a brief moment to boot
      setTimeout(() => {
        resolve(relayStatus === "running");
      }, 800);

    } catch (err: any) {
      addRelayLog(`[System] Error spawning process: ${err.message}`);
      relayStatus = "error";
      resolve(false);
    }
  });
}

function startProxy(): Promise<boolean> {
  return new Promise(async (resolve) => {
    await killProcess(proxyProcess);
    
    proxyLogs.push(`[System] Starting Local Proxy processes... (Configured HTTP host binding: localhost:${proxyPort})`);
    proxyStatus = "running";

    const projectRoot = process.cwd();
    const proxyScript = path.join(projectRoot, "secure_tunnel_project", "securetunnel", "local_proxy.py");

    const args = [
      proxyScript,
      "--host", "127.0.0.1",
      "--port", proxyPort.toString(),
      "--relay-host", "127.0.0.1",
      "--relay-port", relayPort.toString(),
      "--insecure"
    ];

    try {
      proxyProcess = spawn(pythonCmd, args);

      proxyProcess.stdout?.on("data", (data) => {
        addProxyLog(data.toString());
      });

      proxyProcess.stderr?.on("data", (data) => {
        addProxyLog(data.toString());
      });

      proxyProcess.on("error", (err) => {
        addProxyLog(`[System Error] Failed to launch local proxy process: ${err.message}`);
        proxyStatus = "error";
      });

      proxyProcess.on("exit", (code, signal) => {
        addProxyLog(`[System] Local proxy process exited with code ${code} (Signal: ${signal})`);
        proxyStatus = "stopped";
        proxyProcess = null;
      });

      // Give it a brief moment to check if it crashed
      setTimeout(() => {
        resolve(proxyStatus === "running");
      }, 800);

    } catch (err: any) {
      addProxyLog(`[System] Spawn error: ${err.message}`);
      proxyStatus = "error";
      resolve(false);
    }
  });
}

// Start subprocesses at server startup
async function startTunnelServices() {
  addRelayLog("[System] Launching remote secure TCP relay in sandbox environment...");
  const relayOk = await startRelay();
  if (relayOk) {
    addProxyLog("[System] Launching local HTTP tunnel proxy in sandbox environment...");
    await startProxy();
  }
}

startTunnelServices();

// ================= API ENDPOINTS =================

// Endpoint: Probe system diagnostics and execution status
app.get("/api/proxy/status", (req, res) => {
  res.json({
    pythonPath: pythonCmd,
    proxy: {
      status: proxyStatus,
      port: proxyPort,
      logs: proxyLogs
    },
    relay: {
      status: relayStatus,
      port: relayPort,
      logs: relayLogs
    }
  });
});

// Endpoint: Trigger control commands (start, stop, restart, clear logs)
app.post("/api/proxy/control", async (req, res) => {
  const { action, service, customProxyPort, customRelayPort } = req.body;

  if (customProxyPort) proxyPort = parseInt(customProxyPort) || DEFAULT_PROXY_PORT;
  if (customRelayPort) relayPort = parseInt(customRelayPort) || DEFAULT_RELAY_PORT;

  if (action === "clear-logs") {
    if (service === "proxy") {
      proxyLogs = [`[System] Logs cleared.`];
    } else if (service === "relay") {
      relayLogs = [`[System] Logs cleared.`];
    } else {
      proxyLogs = [`[System] Logs cleared.`];
      relayLogs = [`[System] Logs cleared.`];
    }
    return res.json({ success: true });
  }

  if (action === "start") {
    if (service === "relay" || service === "both") {
      await startRelay();
    }
    if (service === "proxy" || service === "both") {
      await startProxy();
    }
    return res.json({ success: true });
  }

  if (action === "stop") {
    if (service === "proxy" || service === "both") {
      await killProcess(proxyProcess);
      proxyLogs.push("[System] Local proxy process terminated manually.");
      proxyStatus = "stopped";
    }
    if (service === "relay" || service === "both") {
      await killProcess(relayProcess);
      relayLogs.push("[System] Relay process terminated manually.");
      relayStatus = "stopped";
    }
    return res.json({ success: true });
  }

  if (action === "restart") {
    await killProcess(proxyProcess);
    await killProcess(relayProcess);
    
    proxyStatus = "stopped";
    relayStatus = "stopped";

    const relayOk = await startRelay();
    if (relayOk) {
      await startProxy();
    }
    return res.json({ success: true });
  }

  res.status(400).json({ error: "Invalid action parameters." });
});

// Endpoint: Perform a diagnostic tunnel request (using curl) to test transmission
app.post("/api/proxy/test", (req, res) => {
  const { targetUrl } = req.body;
  if (!targetUrl) {
    return res.status(400).json({ error: "Target destination URL is required." });
  }

  if (proxyStatus !== "running") {
    return res.status(400).json({ error: "Local proxy is offline. Cannot route request." });
  }

  const startTime = Date.now();
  // We execute curl through our local proxy
  const curlCommand = `curl -s -v -x http://127.0.0.1:${proxyPort} "${targetUrl}"`;
  
  proxyLogs.push(`[System] Initiating test proxy fetch request using curl to: ${targetUrl}`);
  
  exec(curlCommand, { timeout: 10000 }, (error, stdout, stderr) => {
    const latency = Date.now() - startTime;
    
    if (error) {
      const errMsg = error.message || "Unknown error";
      proxyLogs.push(`[System Test Fail] Request to '${targetUrl}' failed: ${errMsg}`);
      return res.json({
        success: false,
        latency,
        error: errMsg,
        diagnostics: stderr
      });
    }

    proxyLogs.push(`[System Test Success] Dynamic request completed in ${latency}ms.`);
    res.json({
      success: true,
      latency,
      responseSize: stdout.length,
      responsePreview: stdout.slice(0, 1500) + (stdout.length > 1500 ? "\n\n[... truncated ...]" : ""),
      diagnostics: stderr
    });
  });
});

// Endpoint: Export the configured python package package in a structured ZIP
app.get("/api/proxy/download-zip", (req, res) => {
  const zipPath = "/tmp/securetunnel.zip";
  
  // Clean old file first
  if (fs.existsSync(zipPath)) {
    try {
      fs.unlinkSync(zipPath);
    } catch {}
  }

  // Construct zip using standard shell commands
  const projectRoot = process.cwd();
  const makeZipCmd = `cd "${path.join(projectRoot, "secure_tunnel_project")}" && zip -r "${zipPath}" securetunnel/ pyproject.toml README.md`;

  exec(makeZipCmd, (err, stdout, stderr) => {
    if (err) {
      console.error("ZIP Generation failure:", err, stderr);
      return res.status(500).json({ error: "Zip packing utility failed on host: " + err.message });
    }
    
    res.download(zipPath, "securetunnel.zip", (downloadErr) => {
      if (downloadErr) {
        console.error("Download pipe broke:", downloadErr);
      }
    });
  });
});

// Endpoint: Read and serve Python files directly to display in a code viewer
app.get("/api/proxy/files", (req, res) => {
  const root = path.join(process.cwd(), "secure_tunnel_project");
  try {
    const pyproject = fs.readFileSync(path.join(root, "pyproject.toml"), "utf-8");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf-8");
    const localProxy = fs.readFileSync(path.join(root, "securetunnel", "local_proxy.py"), "utf-8");
    const remoteRelay = fs.readFileSync(path.join(root, "securetunnel", "remote_relay.py"), "utf-8");

    res.json({
      "pyproject.toml": pyproject,
      "README.md": readme,
      "securetunnel/local_proxy.py": localProxy,
      "securetunnel/remote_relay.py": remoteRelay
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read files of proxy: " + err.message });
  }
});

// Mount Vite middleware for development (or serve static build for production)
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    // Vite middleware for real-time asset compiling
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Direct static production bundle serve
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express developer server running http://localhost:${PORT}`);
  });
};

startServer().catch(err => {
  console.error("Express boot startup crashed:", err);
});
