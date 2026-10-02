import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const resourcePaths = [
  "native/android/app/src/main/res/values/strings.xml",
  "native/android/app/src/main/res/values-zh-rCN/strings.xml",
  "native/android/app/src/main/res/values-ru/strings.xml",
  "native/android/app/src/main/res/values-fa/strings.xml"
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function stringNames(xml) {
  return [...xml.matchAll(/<string\s+name="([^"]+)"/g)].map((match) => match[1]);
}

test("Android localization resources keep identical string key sets", () => {
  const catalogs = resourcePaths.map((resourcePath) => stringNames(read(resourcePath)));
  const baseline = catalogs[0];
  assert.ok(baseline.length > 0);
  for (const catalog of catalogs.slice(1)) {
    assert.deepEqual([...catalog].sort(), [...baseline].sort());
  }
});

test("Android application label is sourced from the localized app_name resource", () => {
  const manifest = read("native/android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android:label="@string\/app_name"/);
  assert.match(manifest, /android:supportsRtl="true"/);
});

test("Android localized resources preserve the verified VPN boundary wording", () => {
  for (const resourcePath of resourcePaths) {
    const xml = read(resourcePath);
    assert.match(xml, /name="vpn_boundary_notice"/);
    assert.match(xml, /VpnService/);
  }
});
