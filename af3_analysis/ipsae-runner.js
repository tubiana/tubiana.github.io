(() => {
  const LOCAL_SOURCE = "../af_scores/IPSAE-main/ipsae.py";
  const REMOTE_SOURCE = "https://raw.githubusercontent.com/DunbrackLab/IPSAE/refs/heads/main/ipsae.py";
  const TMP_DIR = "/tmp";

  const runnerState = {
    pyodidePromise: null
  };

  function sanitizeFilename(name = "file.txt") {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  function stripExtension(path) {
    return path.replace(/\.(pdb|cif)$/i, "");
  }

  function padCutoff(value) {
    const intValue = Math.round(Number(value));
    return intValue < 10 ? `0${intValue}` : String(intValue);
  }

  function detectMode(name = "") {
    const lower = name.toLowerCase();
    if (lower.endsWith(".npz") || lower.endsWith(".pkl") || lower.endsWith(".npy")) {
      return "binary";
    }
    return "text";
  }

  async function ensurePyodideInstance() {
    if (!runnerState.pyodidePromise) {
      runnerState.pyodidePromise = (async () => {
        if (typeof loadPyodide !== "function") {
          throw new Error("Pyodide runtime is not available");
        }
        const pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
        pyodide.setStdout({ batched: (msg) => console.log(msg) });
        pyodide.setStderr({ batched: (msg) => console.warn(msg) });
        await pyodide.loadPackage("numpy");
        await loadIpsaeSource(pyodide);
        ensureTmpDir(pyodide);
        return pyodide;
      })();
    }
    return runnerState.pyodidePromise;
  }

  async function loadIpsaeSource(pyodide) {
    const sources = [LOCAL_SOURCE, REMOTE_SOURCE];
    let script = null;
    let lastError = null;

    for (const url of sources) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Fetch failed with status ${response.status}`);
        }
        script = await response.text();
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!script) {
      throw new Error(`Unable to load ipsae.py. Last error: ${lastError?.message || "unknown"}`);
    }

    pyodide.FS.writeFile("ipsae.py", script);
  }

  function ensureTmpDir(pyodide) {
    try {
      pyodide.FS.mkdir(TMP_DIR);
    } catch (error) {
      // Directory likely exists; ignore EEXIST
    }
  }

  function toUint8Array(text) {
    return new TextEncoder().encode(text);
  }

  async function writeFile(pyodide, path, payload, mode) {
    if (mode === "binary") {
      if (payload instanceof Uint8Array) {
        pyodide.FS.writeFile(path, payload);
      } else if (payload instanceof ArrayBuffer) {
        pyodide.FS.writeFile(path, new Uint8Array(payload));
      } else {
        throw new Error(`Binary payload for ${path} is not supported`);
      }
      return;
    }
    if (typeof payload === "string") {
      pyodide.FS.writeFile(path, payload);
      return;
    }
    // Fallback: attempt to convert ArrayBuffer to string
    if (payload instanceof ArrayBuffer) {
      const decoder = new TextDecoder();
      pyodide.FS.writeFile(path, decoder.decode(payload));
      return;
    }
    throw new Error(`Unsupported payload type for ${path}`);
  }

  function prepareSummaryData(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("Chn1") || trimmed.startsWith("#")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 24) continue;
      const model = parts.slice(23).join(" ");
      rows.push({
        chn1: parts[0],
        chn2: parts[1],
        pae: Number(parts[2]),
        dist: Number(parts[3]),
        type: parts[4],
        ipSAE: Number(parts[5]),
        ipSAE_d0chn: Number(parts[6]),
        ipSAE_d0dom: Number(parts[7]),
        ipTM_af: Number(parts[8]),
        ipTM_d0chn: Number(parts[9]),
        pDockQ: Number(parts[10]),
        pDockQ2: Number(parts[11]),
        LIS: Number(parts[12]),
        n0res: Number(parts[13]),
        n0chn: Number(parts[14]),
        n0dom: Number(parts[15]),
        d0res: Number(parts[16]),
        d0chn: Number(parts[17]),
        d0dom: Number(parts[18]),
        nres1: Number(parts[19]),
        nres2: Number(parts[20]),
        dist1: Number(parts[21]),
        dist2: Number(parts[22]),
        model
      });
    }
    return rows;
  }

  function prepareResidueData(text) {
    const rows = [];
    if (!text) return rows;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("i")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 16) continue;
      rows.push({
        index: Number(parts[0]),
        alignChain: parts[1],
        scoredChain: parts[2],
        alignResNum: Number(parts[3]),
        alignResType: parts[4],
        alignRespLDDT: Number(parts[5]),
        n0chn: Number(parts[6]),
        n0dom: Number(parts[7]),
        n0res: Number(parts[8]),
        d0chn: Number(parts[9]),
        d0dom: Number(parts[10]),
        d0res: Number(parts[11]),
        ipTM: Number(parts[12]),
        ipSAE_d0chn: Number(parts[13]),
        ipSAE_d0dom: Number(parts[14]),
        ipSAE: Number(parts[15])
      });
    }
    return rows;
  }

  async function runIpsae(params) {
    const pyodide = await ensurePyodideInstance();
    ensureTmpDir(pyodide);

    const structureName = sanitizeFilename(params.structure?.name || "structure.cif");
    const paeName = sanitizeFilename(params.pae?.name || "confidence.json");
    const summaryName = params.summary ? sanitizeFilename(params.summary.name || "summary.json") : null;

    const structurePath = `${TMP_DIR}/${structureName}`;
    const paePath = `${TMP_DIR}/${paeName}`;

    await writeFile(pyodide, structurePath, params.structure?.text ?? "", detectMode(structureName));
    await writeFile(pyodide, paePath, params.pae?.text ?? "", detectMode(paeName));

    if (params.summary && summaryName) {
      const summaryPath = `${TMP_DIR}/${summaryName}`;
      await writeFile(pyodide, summaryPath, params.summary.text ?? "", "text");
    }

    const args = [
      "ipsae.py",
      paePath,
      structurePath,
      String(params.paeCutoff ?? 10),
      String(params.distCutoff ?? 10)
    ];
    pyodide.globals.set("ipsae_args", args);

    const command = [
      "import sys",
      "sys.argv = ipsae_args",
      "context = {'__name__': '__main__'}",
      "try:",
      "    exec(open('ipsae.py').read(), context)",
      "except SystemExit as exc:",
      "    if exc.code not in (0, None):",
      "        raise RuntimeError(f'ipsae.py exited with status {exc.code}')",
      "finally:",
      "    for handle_name in ('OUT', 'OUT2', 'PML'):",
      "        handle = context.get(handle_name)",
      "        if handle is None:",
      "            continue",
      "        try:",
      "            handle.flush()",
      "        except Exception:",
      "            pass",
      "        try:",
      "            handle.close()",
      "        except Exception:",
      "            pass"
    ].join("\n");

    await pyodide.runPythonAsync(command);

    const paeString = padCutoff(params.paeCutoff ?? 10);
    const distString = padCutoff(params.distCutoff ?? 10);
    const stem = stripExtension(structurePath);
    const basePath = `${stem}_${paeString}_${distString}`;
    const summaryPath = `${basePath}.txt`;
    const residuePath = `${basePath}_byres.txt`;

    const summaryText = pyodide.FS.readFile(summaryPath, { encoding: "utf8" });
    const residueText = pyodide.FS.readFile(residuePath, { encoding: "utf8" });

    return {
      summaryText,
      residueText,
      summaryRows: prepareSummaryData(summaryText),
      residueRows: prepareResidueData(residueText)
    };
  }

  window.IpsaeRunner = {
    run: runIpsae,
    prepareSummaryData,
    prepareResidueData
  };
})();
