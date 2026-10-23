import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outfile = resolve(root, "native/android/app/src/main/assets/angelanexus-core.bundle.js");

const bufferShim = String.raw`class __AngelaNexusBytes extends Uint8Array {
  toString(encoding = "utf8") {
    if (encoding === "utf8" || encoding === "utf-8") return new TextDecoder().decode(this);
    if (encoding === "base64") {
      let binary = "";
      for (const byte of this) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    throw new TypeError("Unsupported Core buffer encoding: " + encoding);
  }
}
const __AngelaNexusBuffer = {
  from(value, encoding) {
    if (value instanceof Uint8Array) return new __AngelaNexusBytes(value);
    if (value instanceof ArrayBuffer) return new __AngelaNexusBytes(new Uint8Array(value));
    if (encoding === "base64") {
      const binary = atob(String(value).replace(/\s+/g, ""));
      const bytes = new __AngelaNexusBytes(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new __AngelaNexusBytes(new TextEncoder().encode(String(value)));
  },
  concat(values) {
    const total = values.reduce((sum, value) => sum + value.byteLength, 0);
    const result = new __AngelaNexusBytes(total);
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
