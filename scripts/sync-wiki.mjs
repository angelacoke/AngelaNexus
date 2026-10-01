#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const wikiDir = process.argv[2];

if (!wikiDir) {
  throw new Error("Usage: node scripts/sync-wiki.mjs <wiki-directory>");
}

const mappings = [
  ["docs/ANGELANEXUS_CONSTITUTION.md", "Constitution.md"],
  ["docs/PLATFORM_ARCHITECTURE.md", "Platform-Architecture.md"],
  ["docs/APP_PLATFORM_STRATEGY.md", "Platform-Strategy.md"],
  ["docs/APP_UI_DESIGN.md", "UI-Design.md"],
  ["docs/PRODUCT_EXPERIENCE_BASELINE.md", "Product-Experience.md"],
  ["docs/APP_ACCOUNT_SYNC.md", "Account-Sync.md"],
  ["docs/APP_PROGRESS.md", "Progress.md"],
  ["docs/README.md", "Documentation.md"],
  ["docs/zh-CN/README.md", "Documentation-zh-CN.md"],
  ["docs/zh-CN/ANGELANEXUS_CONSTITUTION.md", "Constitution-zh-CN.md"],
  ["docs/zh-CN/PLATFORM_ARCHITECTURE.md", "Platform-Architecture-zh-CN.md"],
  ["docs/zh-CN/APP_PLATFORM_STRATEGY.md", "Platform-Strategy-zh-CN.md"],
  ["docs/zh-CN/APP_UI_DESIGN.md", "UI-Design-zh-CN.md"],
  ["docs/zh-CN/PRODUCT_EXPERIENCE_BASELINE.md", "Product-Experience-zh-CN.md"],
  ["docs/zh-CN/APP_ACCOUNT_SYNC.md", "Account-Sync-zh-CN.md"],
  ["docs/zh-CN/APP_PROGRESS.md", "Progress-zh-CN.md"]
];

function readSource(relativePath) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing source document: ${relativePath}`);
  }
  return fs.readFileSync(source, "utf8");
}

function writeIfChanged(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) {
    return false;
  }
  fs.writeFileSync(target, content, "utf8");
  return true;
}

let changed = 0;

for (const [source, target] of mappings) {
  const content = readSource(source);
  if (writeIfChanged(path.join(wikiDir, target), content)) {
    changed += 1;
  }
}

const home = "# AngelaNexus\n\n智能网络代理平台。\n\nThis Wiki is synchronized from the main repository documentation. **English is the primary documentation language. Simplified Chinese translations are provided for accessibility.**\n\n## Core documentation\n\n### English (primary)\n\n- [Constitution](Constitution)\n- [Platform Architecture](Platform-Architecture)\n- [Platform Strategy](Platform-Strategy)\n- [UI Design](UI-Design)\n- [Product Experience](Product-Experience)\n- [Account & Sync](Account-Sync)\n- [Project Progress](Progress)\n- [Documentation Language Policy](Documentation)\n\n### 简体中文\n\n- [底层宪级纲领](Constitution-zh-CN)\n- [平台架构](Platform-Architecture-zh-CN)\n- [平台策略](Platform-Strategy-zh-CN)\n- [UI 设计](UI-Design-zh-CN)\n- [产品体验基线](Product-Experience-zh-CN)\n- [账户与同步](Account-Sync-zh-CN)\n- [项目进度](Progress-zh-CN)\n- [文档语言规范](Documentation-zh-CN)\n\n## Sync policy\n\n- English is the normative documentation language.\n- Chinese pages mirror the same architecture and product semantics.\n- Only explicitly managed pages are synchronized.\n- Unmanaged Wiki pages are preserved.\n- Missing source files fail the synchronization.\n- Unchanged content does not create unnecessary commits.\n";

if (writeIfChanged(path.join(wikiDir, "Home.md"), home)) {
  changed += 1;
}

console.log(`Wiki synchronization prepared: ${changed} managed page(s) changed.`);
