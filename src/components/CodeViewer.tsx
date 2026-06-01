import { useState } from "react";
import { Folder, FileText, Code, Copy, Check, Info } from "lucide-react";
import { PackageFiles } from "../types";

interface CodeViewerProps {
  files: PackageFiles | null;
  isLoading: boolean;
}

export default function CodeViewer({ files, isLoading }: CodeViewerProps) {
  const [selectedFile, setSelectedFile] = useState<keyof PackageFiles>("securetunnel/local_proxy.py");
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-10 bg-slate-900/10 border border-slate-800 rounded-xl">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-teal-500/30 border-t-teal-400 mb-2"></div>
        <p className="text-xs text-slate-400">Loading package codebase index...</p>
      </div>
    );
  }

  if (!files) {
    return (
      <div className="p-6 bg-slate-900/10 border border-slate-800 rounded-xl text-center text-xs text-slate-400">
        ❌ Code files index index is unavailable.
      </div>
    );
  }

  const fileKeys: (keyof PackageFiles)[] = [
    "pyproject.toml",
    "securetunnel/local_proxy.py",
    "securetunnel/remote_relay.py",
    "tests/test_interaction.py",
    "README.md",
    "LICENSE"
  ];

  const handleCopy = () => {
    navigator.clipboard.writeText(files[selectedFile]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const getLanguageTag = (filepath: string) => {
    if (filepath.endsWith(".py")) return "Python";
    if (filepath.endsWith(".toml")) return "TOML";
    if (filepath.endsWith(".md")) return "Markdown";
    return "Plaintext";
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 shadow-lg" id="code_explorer">
      {/* Visual Workspace Subheader */}
      <div className="border-b border-slate-800/80 px-5 py-4 bg-slate-900/60 rounded-t-xl flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Code className="h-4 w-4 text-teal-400 stroke-[1.8]" />
          Target Code Explorer
        </h2>
        <span className="font-mono text-[10px] text-slate-500 uppercase bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
          Editable Layout
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 min-h-[480px]">
        {/* Left Side: Folder & File tree */}
        <div className="border-r border-slate-800 p-4 bg-slate-950/20 md:col-span-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-3 px-1">
            <Folder className="h-4 w-4 text-amber-500 fill-amber-500/20" />
            <span>securetunnel-project</span>
          </div>

          <nav className="flex flex-col gap-1">
            {fileKeys.map((file) => {
              const isSelected = selectedFile === file;
              const isNested = file.includes("/");
              return (
                <button
                  key={file}
                  onClick={() => {
                    setSelectedFile(file);
                    setCopied(false);
                  }}
                  id={`btn_select_file_${file.replace(/[\/\.]/g, "_")}`}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium tracking-wide transition-all ${
                    isSelected
                      ? "bg-teal-500/10 text-teal-400 border border-teal-500/20 shadow-[0_0_10px_rgba(45,212,191,0.05)]"
                      : "text-slate-400 hover:bg-slate-900/60 hover:text-slate-200 border border-transparent"
                  } ${isNested ? "ml-4" : ""}`}
                >
                  <FileText className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? 'text-teal-400' : 'text-slate-500'}`} />
                  <span className="truncate font-mono text-[11px]">{isNested ? file.split("/")[1] : file}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-8 rounded-lg bg-slate-950/40 p-3.5 border border-slate-800/60 text-[10px] text-slate-400 leading-relaxed">
            <div className="font-semibold text-slate-300 flex items-center gap-1 mb-1">
              <Info className="h-3 w-3 text-teal-400" /> Package Structure
            </div>
            This structure is compliant with standard Python setuptools building parameters, configuring scripts as native OS entry-points dynamically when installed.
          </div>
        </div>

        {/* Right Side: Code viewer screen */}
        <div className="flex flex-col md:col-span-3 bg-slate-950/50">
          {/* File attributes bar */}
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/30 px-5 py-2.5">
            <span className="font-mono text-[11px] font-semibold text-slate-300 flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-slate-500" />
              {selectedFile}
              <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
                {getLanguageTag(selectedFile)}
              </span>
            </span>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-all cursor-pointer"
              title="Copy original code contents to clipboard"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400 text-[11px] font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[11px]">Copy Raw Code</span>
                </>
              )}
            </button>
          </div>

          {/* Actual Code View Block */}
          <div className="flex-1 overflow-auto max-h-[420px] p-5 font-mono text-xs text-slate-300 select-text leading-relaxed whitespace-pre bg-slate-950/90 leading-relaxed">
            {files[selectedFile].split("\n").map((line, idx) => (
              <div key={idx} className="flex hover:bg-slate-900/30">
                <span className="w-10 pr-4 block text-right border-r border-slate-800/80 mr-4 select-none text-slate-600 font-mono text-[10px]">
                  {idx + 1}
                </span>
                <span className="flex-1 whitespace-pre max-w-full select-text selection:bg-teal-500/30 rounded">
                  {line}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
