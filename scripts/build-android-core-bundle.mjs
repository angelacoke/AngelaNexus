import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outfile = resolve(root, "native/android/app/src/main/assets/angelanexus-core.bundle.js");

const bufferShim = String.raw`const __AngelaNexusBuffer = {
  from(value, encoding) {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (encoding === "base64") {
      const binary = atob(String(value).replace(/\\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new TextEncoder().encode(String(value));
  },
  concat(values) {
    const total = values.reduce((sum, value) => sum + value.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const value of values) {
      result.set(value, offset);
      offset += value.byteLength;
    }
    return result;
  },
  byteLength(value) {
    return new TextEncoder().encode(String(value)).byteLength;
  },
  isBuffer(value) {
    return value instanceof Uint8Array;
  }
};
globalThis.Buffer = globalThis.Buffer || __AngelaNexusBuffer;`;

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, "src/platform/android-core-runtime-entry.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile,
  banner: { js: bufferShim },
  legalComments: "eof",
  sourcemap: false,
  minify: false,
});

console.log("AngelaNexus Android Core bundle generated:", outfile);
