const CAPABILITIES = Object.freeze({
  mihomo: Object.freeze({
    android: Object.freeze({ process: true, native: false }),
    ios: Object.freeze({ process: false, native: false }),
    windows: Object.freeze({ process: true, native: false }),
    macos: Object.freeze({ process: true, native: false }),
    linux: Object.freeze({ process: true, native: false }),
  }),
  "sing-box": Object.freeze({
    android: Object.freeze({ process: true, native: true }),
    ios: Object.freeze({ process: true, native: true }),
    windows: Object.freeze({ process: true, native: false }),
    macos: Object.freeze({ process: true, native: false }),
    linux: Object.freeze({ process: true, native: false }),
  }),
  xray: Object.freeze({
    android: Object.freeze({ process: true, native: true }),
    ios: Object.freeze({ process: true, native: true }),
    windows: Object.freeze({ process: true, native: false }),
    macos: Object.freeze({ process: true, native: false }),
    linux: Object.freeze({ process: true, native: false }),
  }),
});

export function getKernelRuntimeCapabilities(kernel, platform) {
  const kernelCapabilities = CAPABILITIES[kernel];
  if (!kernelCapabilities) throw new Error("unsupported kernel runtime: " + kernel);
  const capabilities = kernelCapabilities[platform];
  if (!capabilities) throw new Error("unsupported platform: " + platform);
  return capabilities;
}

export function supportsKernelRuntime(kernel, platform, mode) {
  if (mode !== "process" && mode !== "native") {
    throw new TypeError("unsupported kernel runtime mode: " + mode);
  }
  return getKernelRuntimeCapabilities(kernel, platform)[mode];
}
