export interface ServiceState {
  status: "running" | "stopped" | "error";
  port: number;
  logs: string[];
}

export interface ProxySystemStatus {
  pythonPath: string;
  proxy: ServiceState;
  relay: ServiceState;
}

export interface TunnelTestResult {
  success: boolean;
  latency?: number;
  responseSize?: number;
  responsePreview?: string;
  error?: string;
  diagnostics?: string;
}

export interface PackageFiles {
  "pyproject.toml": string;
  "README.md": string;
  "securetunnel/local_proxy.py": string;
  "securetunnel/remote_relay.py": string;
  "LICENSE": string;
  "tests/test_interaction.py": string;
  ".github/workflows/ci.yml"?: string;
  ".github/workflows/release.yml"?: string;
}
