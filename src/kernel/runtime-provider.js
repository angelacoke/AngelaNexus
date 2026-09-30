const MODES = new Set(["process", "native"]);

export function createKernelRuntimeProvider({
  kernel,
  mode = "process",
  processFactory,
  nativeFactory,
} = {}) {
  if (!kernel) throw new TypeError("kernel is required");
  if (!MODES.has(mode)) throw new TypeError("unsupported kernel runtime mode: " + mode);

  if (mode === "process") {
    if (typeof processFactory !== "function") {
      throw new TypeError("process runtime factory is required");
    }
    return Object.freeze({
      kernel,
      mode,
      create(options = {}) {
        return processFactory(kernel, options);
      },
    });
  }

  if (typeof nativeFactory !== "function") {
    throw new TypeError("native runtime factory is required");
  }

  return Object.freeze({
    kernel,
    mode,
    create(options = {}) {
      return nativeFactory(kernel, options);
    },
  });
}

export { MODES as KERNEL_RUNTIME_MODES };
