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
  ["docs/APP_PROGRESS.md", "Progress.md"]
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

const home = `# AngelaNexus

智能网络代理平台。

本 Wiki 与主仓库中的规范文档保持同步。主仓库是文档源，Wiki 用于阅读与导航。

## 核心规范

- [项目宪章](Constitution)
- [平台架构](Platform-Architecture)
- [平台策略](Platform-Strategy)
- [UI 设计](UI-Design)
- [产品体验基线](Product-Experience)
- [账户同步](Account-Sync)
- [项目进度](Progress)

## 同步原则

- 仅同步明确列入白名单的文档。
- 不删除 Wiki 中未受本同步器管理的页面。
- 源文件缺失时同步失败，不生成空页面。
- 内容未发生变化时不创建无意义提交。
`;

if (writeIfChanged(path.join(wikiDir, "Home.md"), home)) {
  changed += 1;
}

console.log(`Wiki synchronization prepared: ${changed} managed page(s) changed.`);
