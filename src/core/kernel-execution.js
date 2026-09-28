import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { compileUnifiedConfig } from "./config-compiler.js";
import { Kernels } from "./model.js";
import { createKernelRuntime } from "../kernel/runtime-registry.js";

const CONFIG_NAMES = Object.freeze({
  [Kernels.MIHOMO]: "config.yaml",
  [Kernels.SING_BOX]: "config.json",
  [Kernels.XRAY]: "config.json"
});

function serialize(kernel, config) {
  return kernel === Kernels.MIHOMO
    ? yaml.dump(config, { noRefs: true })
    : JSON.stringify(config, null, 2) + "\n";
}

function runtimeArgs(kernel, configPath) {
  if (kernel === Kernels.MIHOMO) return ["-f", configPath];
  if (kernel === Kernels.SING_BOX) return ["run", "-c", configPath];
  if (kernel === Kernels.XRAY) return ["run", "-c", configPath];
  throw new Error("unsupported kernel runtime: " + kernel);
}

function assertRuntimeOptions(options) {
  if (!options || typeof options !== "object") throw new TypeError("runtime options are required");
  if (!options.binary || typeof options.binary !== "string") throw new TypeError("runtime binary is required");
  if (options.runtimeFactory !== undefined && typeof options.runtimeFactory !== "function") {
    throw new TypeError("runtimeFactory must be a function");
  }
}

export async function createKernelExecution(config, options = {}) {
  assertRuntimeOptions(options);
  const kernel = config && config.kernel;
  if (!Object.values(Kernels).includes(kernel)) throw new Error("unsupported kernel: " + kernel);

  const compiled = compileUnifiedConfig(config, kernel);
  const managedWorkdir = !options.workdir;
  const baseDir = options.workdir || await mkdtemp(join(tmpdir(), "angela-nexus-"));
  if (options.workdir) await mkdir(baseDir, { recursive: true, mode: 0o700 });

  const configPath = join(baseDir, CONFIG_NAMES[kernel]);
  const content = serialize(kernel, compiled.config);
  await writeFile(configPath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(configPath, 0o600);

  const runtimeFactory = options.runtimeFactory || createKernelRuntime;
  let runtime;
  try {
    runtime = runtimeFactory(kernel, {
    binary: options.binary,
    args: runtimeArgs(kernel, configPath),
    cwd: options.cwd || baseDir,
    env: options.env,
    reloadSignal: options.reloadSignal
  });
  } catch (error) {
    if (managedWorkdir) await rm(baseDir, { recursive: true, force: true });
    throw error;
  }
  if (!runtime || typeof runtime.start !== "function" || typeof runtime.stop !== "function" || typeof runtime.status !== "function") {
    if (managedWorkdir) await rm(baseDir, { recursive: true, force: true });
    throw new TypeError("runtimeFactory must return a kernel runtime");
  }

  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (managedWorkdir) await rm(baseDir, { recursive: true, force: true });
  }

  return Object.freeze({
    kernel,
    configPath,
    compiled,
    async start() {
      const state = await runtime.status();
      if (state.running) throw new Error("kernel runtime already running");
      return runtime.start();
    },
    async stop() {
      const result = await runtime.stop();
      await cleanup();
      return result;
    },
    async reload() {
      if (typeof runtime.reload !== "function") throw new Error(kernel + " runtime does not implement reload");
      return runtime.reload();
    },
    async status() {
      return runtime.status();
    },
    async logs(logOptions = {}) {
      if (typeof runtime.logs !== "function") return [];
      return runtime.logs(logOptions);
    },
    async cleanup() {
      const state = await runtime.status();
      if (state.running) throw new Error("cannot cleanup a running kernel runtime");
      await cleanup();
    }
  });
}
