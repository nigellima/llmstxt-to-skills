#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const VERSION = "1.1.3";
const REGISTRY_FILENAME = ".agent-skills-registry.toml";
const USER_AGENT = `llmstxt-to-skills/${VERSION}`;
const REQUEST_TIMEOUT_MS = 30_000;

function printUsage() {
  console.log(`Generate agent skills from llms.txt documentation files

Usage:
  llmstxt-to-skills <llms.txt-url-or-path> [--output-dir <dir>] [--skill-name <name>] [--root-dir <dir>] [--source-base-url <url>] [--include <glob>] [--exclude <glob>]
  llmstxt-to-skills --url <llms.txt-url-or-path> [--output-dir <dir>] [--skill-name <name>] [--root-dir <dir>] [--source-base-url <url>] [--include <glob>] [--exclude <glob>]
  llmstxt-to-skills init [--registry <path>]
  llmstxt-to-skills add <url-or-path> [--skill-name <name>] [--root-dir <dir>] [--source-base-url <url>] [--include <glob>] [--exclude <glob>] [--registry <path>]
  llmstxt-to-skills list [--registry <path>]
  llmstxt-to-skills update [--source <url-or-path>] [--registry <path>] [--output-dir <dir>]

Global options:
  --url <source>        URL or local path to llms.txt (standalone mode)
  -o, --output-dir <d>  Output directory (default: ./skills)
  --skill-name <name>   Custom generated skill name (defaults to source domain)
  --root-dir <dir>      Directory for resolving root-relative local links like /docs/page.md
  --source-base-url <u> Public/base URL to write in Source metadata for local links
  --include <glob>      Include URL pattern (repeatable)
  --exclude <glob>      Exclude URL pattern (repeatable)
  -h, --help            Show this help
  -v, --version         Show version`);
}

function parseArgs(argv) {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  let command = null;
  const knownCommands = new Set(["init", "add", "update", "list"]);
  if (args.length > 0 && knownCommands.has(args[0])) {
    command = args.shift();
  }

  const global = {
    url: null,
    outputDir: "./skills",
    skillName: null,
    rootDir: null,
    sourceBaseUrl: null,
    include: [],
    exclude: [],
  };

  const commandOpts = {
    registry: null,
    source: null,
    skillName: null,
    rootDir: null,
    sourceBaseUrl: null,
    include: [],
    exclude: [],
    positionals: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => {
      if (i + 1 >= args.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return args[i];
    };

    if (arg === "--url") {
      global.url = next();
      continue;
    }
    if (arg.startsWith("--url=")) {
      global.url = arg.slice("--url=".length);
      continue;
    }
    if (arg === "--output-dir" || arg === "-o") {
      global.outputDir = next();
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      global.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    if (arg === "--skill-name") {
      const skillName = next();
      if (command === "add") {
        commandOpts.skillName = skillName;
      } else {
        global.skillName = skillName;
      }
      continue;
    }
    if (arg.startsWith("--skill-name=")) {
      const skillName = arg.slice("--skill-name=".length);
      if (command === "add") {
        commandOpts.skillName = skillName;
      } else {
        global.skillName = skillName;
      }
      continue;
    }
    if (arg === "--root-dir") {
      const rootDir = next();
      if (command === "add") {
        commandOpts.rootDir = rootDir;
      } else {
        global.rootDir = rootDir;
      }
      continue;
    }
    if (arg === "--source-base-url") {
      const sourceBaseUrl = next();
      if (command === "add") {
        commandOpts.sourceBaseUrl = sourceBaseUrl;
      } else {
        global.sourceBaseUrl = sourceBaseUrl;
      }
      continue;
    }
    if (arg.startsWith("--source-base-url=")) {
      const sourceBaseUrl = arg.slice("--source-base-url=".length);
      if (command === "add") {
        commandOpts.sourceBaseUrl = sourceBaseUrl;
      } else {
        global.sourceBaseUrl = sourceBaseUrl;
      }
      continue;
    }
    if (arg.startsWith("--root-dir=")) {
      const rootDir = arg.slice("--root-dir=".length);
      if (command === "add") {
        commandOpts.rootDir = rootDir;
      } else {
        global.rootDir = rootDir;
      }
      continue;
    }
    if (arg === "--registry") {
      commandOpts.registry = next();
      continue;
    }
    if (arg.startsWith("--registry=")) {
      commandOpts.registry = arg.slice("--registry=".length);
      continue;
    }
    if (arg === "--source") {
      commandOpts.source = next();
      continue;
    }
    if (arg.startsWith("--source=")) {
      commandOpts.source = arg.slice("--source=".length);
      continue;
    }
    if (arg === "--include") {
      const pattern = next();
      if (command === "add") {
        commandOpts.include.push(pattern);
      } else {
        global.include.push(pattern);
      }
      continue;
    }
    if (arg.startsWith("--include=")) {
      const pattern = arg.slice("--include=".length);
      if (command === "add") {
        commandOpts.include.push(pattern);
      } else {
        global.include.push(pattern);
      }
      continue;
    }
    if (arg === "--exclude") {
      const pattern = next();
      if (command === "add") {
        commandOpts.exclude.push(pattern);
      } else {
        global.exclude.push(pattern);
      }
      continue;
    }
    if (arg.startsWith("--exclude=")) {
      const pattern = arg.slice("--exclude=".length);
      if (command === "add") {
        commandOpts.exclude.push(pattern);
      } else {
        global.exclude.push(pattern);
      }
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    commandOpts.positionals.push(arg);
  }

  return { command, global, commandOpts };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function isHttpUrl(source) {
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isFileUrl(source) {
  try {
    return new URL(source).protocol === "file:";
  } catch {
    return false;
  }
}

function resolveSource(source) {
  if (isHttpUrl(source) || isFileUrl(source)) {
    return new URL(source).toString();
  }

  return pathToFileURL(path.resolve(source)).toString();
}

function fileUrlFromDirectory(dirPath) {
  const withSeparator = dirPath.endsWith(path.sep) ? dirPath : `${dirPath}${path.sep}`;
  return pathToFileURL(withSeparator).toString();
}

function resolveRootUrl(rootDir, sourceUrl) {
  if (!rootDir || !isFileUrl(sourceUrl)) {
    return null;
  }

  if (isFileUrl(rootDir)) {
    return fileUrlFromDirectory(fileURLToPath(rootDir));
  }

  return fileUrlFromDirectory(path.resolve(rootDir));
}

function resolveSourceBaseUrl(sourceBaseUrl) {
  if (!sourceBaseUrl) {
    return null;
  }

  try {
    return new URL(sourceBaseUrl).toString();
  } catch (err) {
    throw new Error(`Invalid source base URL: ${sourceBaseUrl} (${err.message})`);
  }
}

async function readTextSource(sourceUrl) {
  const url = new URL(sourceUrl);

  if (url.protocol === "file:") {
    const filePath = fileURLToPath(url);
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT" && filePath.endsWith(".md")) {
        const indexPath = path.join(filePath.slice(0, -".md".length), "index.md");
        return fs.readFile(indexPath, "utf8");
      }
      throw err;
    }
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return fetchText(sourceUrl);
  }

  throw new Error(`Unsupported source protocol: ${url.protocol}`);
}

async function fetchLlmsTxt(sourceUrl) {
  try {
    return await readTextSource(sourceUrl);
  } catch (err) {
    throw new Error(`Failed to read llms.txt from ${sourceUrl}: ${err.message}`);
  }
}

function parseLlmsTxt(content, baseUrl, rootUrl = null, sourceBaseUrl = null) {
  const h1Re = /^# (.+)$/;
  const h2Re = /^## (.+)$/;
  const entryRe = /^-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s+(.*))?$/;

  const base = new URL(baseUrl);
  const sourceBase = sourceBaseUrl ? new URL(sourceBaseUrl) : null;
  let title = null;
  const summaryLines = [];
  const sections = [];
  let currentSection = null;
  let currentEntries = [];
  let inBlockquote = false;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();

    const h1Match = trimmed.match(h1Re);
    if (h1Match) {
      if (!title) {
        title = h1Match[1];
      }
      continue;
    }

    if (trimmed.startsWith(">")) {
      inBlockquote = true;
      const summaryLine = trimmed.slice(1).trim();
      if (summaryLine) {
        summaryLines.push(summaryLine);
      }
      continue;
    } else if (inBlockquote && trimmed && !trimmed.startsWith("#")) {
      continue;
    } else {
      inBlockquote = false;
    }

    const h2Match = trimmed.match(h2Re);
    if (h2Match) {
      if (currentSection && currentEntries.length > 0) {
        sections.push([currentSection, currentEntries]);
      }
      currentSection = h2Match[1];
      currentEntries = [];
      continue;
    }

    const entryMatch = trimmed.match(entryRe);
    if (entryMatch) {
      const entryTitle = entryMatch[1];
      const urlStr = entryMatch[2];
      const description = entryMatch[3] || "";

      let resolvedUrl;
      if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
        resolvedUrl = urlStr;
      } else if (rootUrl && urlStr.startsWith("/")) {
        try {
          resolvedUrl = new URL(`.${urlStr}`, rootUrl).toString();
        } catch (err) {
          throw new Error(`Failed to resolve URL: ${urlStr} (${err.message})`);
        }
      } else {
        try {
          resolvedUrl = new URL(urlStr, base).toString();
        } catch (err) {
          throw new Error(`Failed to resolve URL: ${urlStr} (${err.message})`);
        }
      }

      let sourceUrl = resolvedUrl;
      if (sourceBase && !urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
        try {
          sourceUrl = new URL(urlStr, sourceBase).toString();
        } catch (err) {
          throw new Error(`Failed to resolve source URL: ${urlStr} (${err.message})`);
        }
      }

      const sectionName = currentSection || "General";
      const entry = {
        title: entryTitle,
        url: sourceUrl,
        description,
        section: sectionName,
      };
      if (sourceUrl !== resolvedUrl) {
        entry.contentUrl = resolvedUrl;
      }
      currentEntries.push(entry);
    }
  }

  if (currentSection && currentEntries.length > 0) {
    sections.push([currentSection, currentEntries]);
  } else if (!currentSection && currentEntries.length > 0) {
    sections.push(["General", currentEntries]);
  }

  const summary = summaryLines.length > 0 ? summaryLines.join(" ") : null;

  return { title, summary, sections };
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function buildMatchers(patterns) {
  return patterns.map((pattern) => {
    try {
      return globToRegExp(pattern);
    } catch (err) {
      throw new Error(`Invalid glob pattern: ${pattern} (${err.message})`);
    }
  });
}

function applyFilters(entries, includePatterns, excludePatterns) {
  const includeMatchers = buildMatchers(includePatterns);
  const excludeMatchers = buildMatchers(excludePatterns);

  return entries.filter((entry) => {
    if (
      excludeMatchers.length > 0 &&
      excludeMatchers.some((matcher) => matcher.test(entry.url))
    ) {
      return false;
    }

    if (includeMatchers.length > 0) {
      return includeMatchers.some((matcher) => matcher.test(entry.url));
    }

    return true;
  });
}

function extractDomainName(sourceUrl) {
  let hostname;
  try {
    hostname = new URL(sourceUrl).hostname;
  } catch (err) {
    throw new Error(`Failed to parse source URL: ${sourceUrl} (${err.message})`);
  }

  if (!hostname) {
    throw new Error("No host in URL");
  }

  const sanitized = hostname.toLowerCase().replace(/\./g, "-");
  return sanitized.replace(/[^\w-]/g, "");
}

function normalizeSkillName(input) {
  const normalized = String(input)
    .trim()
    .toLowerCase()
    .replace(/[.\s/]+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  if (!normalized) {
    throw new Error(`Invalid skill name: ${input}`);
  }

  return normalized;
}

function entryTitleToFilename(title) {
  const lowercase = title.toLowerCase();
  const withUnderscores = lowercase.replace(/[ -]/g, "_");
  const clean = withUnderscores.replace(/[^\w_]/g, "");
  const trimmed = clean.replace(/^_+|_+$/g, "");
  const base = trimmed || "untitled";
  return `${base}.md`;
}

function escapeYamlDoubleQuoted(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\u0008/g, "\\b")
    .replace(/\f/g, "\\f");
}

function getRegistryPath(customPath) {
  return customPath || REGISTRY_FILENAME;
}

function parseTomlString(value) {
  const m = value.match(/^"(.*)"$/);
  if (!m) {
    throw new Error(`Expected string value, got: ${value}`);
  }
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseTomlStringArray(value) {
  const trimmed = value.trim();
  if (trimmed === "[]") {
    return [];
  }
  const matches = [...trimmed.matchAll(/"((?:\\.|[^"])*)"/g)];
  return matches.map((m) => m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
}

function loadRegistryFromText(text) {
  const config = { sources: [] };
  let current = null;
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line === "[[source]]") {
      current = {
        url: "",
        skill_name: null,
        root_dir: null,
        source_base_url: null,
        include: [],
        exclude: [],
      };
      config.sources.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) {
      continue;
    }
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();

    if (key === "url") {
      current.url = parseTomlString(value);
    } else if (key === "skill_name") {
      current.skill_name = parseTomlString(value);
    } else if (key === "root_dir") {
      current.root_dir = parseTomlString(value);
    } else if (key === "source_base_url") {
      current.source_base_url = parseTomlString(value);
    } else if (key === "include") {
      current.include = parseTomlStringArray(value);
    } else if (key === "exclude") {
      current.exclude = parseTomlStringArray(value);
    }
  }

  config.sources = config.sources.filter((src) => src.url);
  return config;
}

function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tomlArray(values) {
  return `[${values.map((v) => `"${escapeTomlString(v)}"`).join(", ")}]`;
}

function registryToToml(config) {
  const lines = [];
  for (const source of config.sources) {
    lines.push("[[source]]");
    lines.push(`url = "${escapeTomlString(source.url)}"`);
    if (source.skill_name) {
      lines.push(`skill_name = "${escapeTomlString(source.skill_name)}"`);
    }
    if (source.root_dir) {
      lines.push(`root_dir = "${escapeTomlString(source.root_dir)}"`);
    }
    if (source.source_base_url) {
      lines.push(`source_base_url = "${escapeTomlString(source.source_base_url)}"`);
    }
    lines.push(`include = ${tomlArray(source.include || [])}`);
    lines.push(`exclude = ${tomlArray(source.exclude || [])}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function loadRegistry(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read registry file: ${filePath} (${err.message})`);
  }

  try {
    return loadRegistryFromText(content);
  } catch (err) {
    throw new Error(`Failed to parse registry TOML: ${err.message}`);
  }
}

async function saveRegistry(filePath, config) {
  const content = registryToToml(config);
  try {
    await fs.writeFile(filePath, content, "utf8");
  } catch (err) {
    throw new Error(`Failed to write registry file: ${filePath} (${err.message})`);
  }
}

async function readMetadata(skillDir) {
  const metadataPath = path.join(skillDir, ".metadata.json");
  try {
    const content = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function fetchMarkdownContent(url) {
  try {
    return await readTextSource(url);
  } catch (err) {
    console.log(`  Warning: Failed to read ${url}: ${err.message}`);
    return null;
  }
}

async function generateDomainSkill(parsed, sourceUrl, skillName, outputDir) {
  const skillDir = path.join(outputDir, skillName);
  const referencesDir = path.join(skillDir, "references");
  await ensureDir(referencesDir);

  const totalEntries = parsed.sections.reduce(
    (sum, [, entries]) => sum + entries.length,
    0
  );

  const skillTitle = parsed.title || skillName;
  let description = parsed.summary
    ? `${parsed.summary.replace(/\.+$/, "")}.`
    : `Documentation and reference materials for ${skillTitle}.`;

  if (parsed.sections.length > 0) {
    const sectionNames = parsed.sections.map(([name]) => name);
    description += ` Contains ${totalEntries} reference documents organized into sections: ${sectionNames.join(
      ", "
    )}.`;
  }

  while (description.length < 200) {
    description += ` Use this skill when working with ${skillTitle} documentation or when the user mentions topics covered in these references.`;
  }

  if (description.length > 1024) {
    description = `${description.slice(0, 1021)}...`;
  }

  const descriptionYaml = escapeYamlDoubleQuoted(description);
  let skillMd = `---
name: ${skillName}
description: "${descriptionYaml}"
version: 1.0.0
---

# ${skillTitle}

`;

  if (parsed.summary) {
    skillMd += `## Overview

${parsed.summary}

`;
  }

  skillMd += `## How to Use This Skill

This skill contains ${totalEntries} reference documents organized by topic. When you need information about ${skillTitle}:

1. Use the table of contents below to locate the most relevant reference files
2. Reference files are organized in the \`references/\` directory by topic
3. Each reference contains detailed documentation extracted from the official source

## Reference Documentation

`;

  for (const [sectionName, entries] of parsed.sections) {
    skillMd += `### ${sectionName}

`;
    for (const entry of entries) {
      const filename = entryTitleToFilename(entry.title);
      const descriptionText = entry.description ? ` - ${entry.description}` : "";
      skillMd += `- [${entry.title}](references/${filename})${descriptionText}\n`;
    }
    skillMd += "\n";
  }

  const skillMdPath = path.join(skillDir, "SKILL.md");
  await fs.writeFile(skillMdPath, skillMd, "utf8");
  console.log("  Created SKILL.md");

  let entryCount = 0;
  for (const [sectionName, entries] of parsed.sections) {
    console.log(`\n  Processing section: ${sectionName}`);
    for (const entry of entries) {
      const filename = entryTitleToFilename(entry.title);
      const referencePath = path.join(referencesDir, filename);
      console.log(`    Fetching: ${entry.title} -> ${filename}`);

      const content = await fetchMarkdownContent(entry.contentUrl || entry.url);
      if (content == null) {
        console.log("      ✗ Failed to fetch content");
        continue;
      }

      let referenceContent = `# ${entry.title}

**Source:** ${entry.url}
**Section:** ${sectionName}

`;
      if (entry.description) {
        referenceContent += `**Description:** ${entry.description}\n\n---\n\n`;
      } else {
        referenceContent += "---\n\n";
      }
      referenceContent += content;

      await fs.writeFile(referencePath, referenceContent, "utf8");
      entryCount += 1;
      console.log("      ✓ Saved");
    }
  }

  const sectionNames = parsed.sections.map(([name]) => name);
  const metadata = {
    source_url: sourceUrl,
    skill_name: skillName,
    entry_count: entryCount,
    sections: sectionNames,
    generated_at: new Date().toISOString(),
    generator_version: VERSION,
  };
  const metadataPath = path.join(skillDir, ".metadata.json");
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

  console.log(
    `\n  ✓ Skill complete: ${entryCount} references in ${parsed.sections.length} sections`
  );
  return skillDir;
}

function extractFileSourceName(sourceUrl) {
  let filePath;
  try {
    filePath = fileURLToPath(sourceUrl);
  } catch (err) {
    throw new Error(`Failed to parse source file URL: ${sourceUrl} (${err.message})`);
  }

  const parsed = path.parse(filePath);
  const baseName = parsed.name.toLowerCase() === "llms" ? path.basename(parsed.dir) : parsed.name;
  return normalizeSkillName(baseName);
}

function extractSourceName(sourceUrl) {
  if (isFileUrl(sourceUrl)) {
    return extractFileSourceName(sourceUrl);
  }

  return extractDomainName(sourceUrl);
}

async function generateFromSource(
  sourceInput,
  outputDir,
  include,
  exclude,
  skillNameOverride,
  rootDir = null,
  sourceBaseUrl = null
) {
  const sourceUrl = resolveSource(sourceInput);
  console.log(`Reading llms.txt from ${sourceInput}...`);
  const llmsTxtContent = await fetchLlmsTxt(sourceUrl);

  console.log("Parsing llms.txt...");
  const parsed = parseLlmsTxt(
    llmsTxtContent,
    sourceUrl,
    resolveRootUrl(rootDir, sourceUrl),
    resolveSourceBaseUrl(sourceBaseUrl)
  );

  const totalEntries = parsed.sections.reduce(
    (sum, [, entries]) => sum + entries.length,
    0
  );
  console.log(`Found ${totalEntries} entries in ${parsed.sections.length} sections`);

  if (include.length > 0 || exclude.length > 0) {
    console.log("Applying filters...");
    const filteredSections = [];
    for (const [sectionName, entries] of parsed.sections) {
      const filteredEntries = applyFilters(entries, include, exclude);
      if (filteredEntries.length > 0) {
        filteredSections.push([sectionName, filteredEntries]);
      }
    }
    parsed.sections = filteredSections;

    const filteredCount = parsed.sections.reduce(
      (sum, [, entries]) => sum + entries.length,
      0
    );
    console.log(
      `After filtering: ${filteredCount} entries in ${parsed.sections.length} sections`
    );

    if (filteredCount === 0) {
      console.log("No entries remaining after filtering");
      return { success: 0, failed: 1 };
    }
  }

  const skillName = skillNameOverride
    ? normalizeSkillName(skillNameOverride)
    : extractSourceName(sourceUrl);
  console.log(`\nGenerating skill: ${skillName}`);

  await ensureDir(outputDir);
  try {
    const skillDir = await generateDomainSkill(parsed, sourceInput, skillName, outputDir);
    console.log(`\n✓ Successfully generated skill: ${skillDir}`);
    return { success: 1, failed: 0 };
  } catch (err) {
    console.log(`\n✗ Failed to generate skill: ${err.message}`);
    return { success: 0, failed: 1 };
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCli(argv = process.argv.slice(2)) {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available. Use Node.js 18+.");
  }

  const cli = parseArgs(argv);
  const outputDir = cli.global.outputDir;
  const registryPath = getRegistryPath(cli.commandOpts.registry);

  switch (cli.command) {
    case "init": {
      if (await fileExists(registryPath)) {
        throw new Error(`Registry file already exists: ${registryPath}`);
      }
      await saveRegistry(registryPath, { sources: [] });
      console.log(`Created registry file: ${registryPath}`);
      console.log("\nAdd sources with:");
      console.log("  llmstxt-to-skills add <url>");
      return;
    }

    case "add": {
      const url = cli.commandOpts.positionals[0];
      if (!url) {
        throw new Error("Missing URL. Usage: llmstxt-to-skills add <url>");
      }

      const config = (await fileExists(registryPath))
        ? await loadRegistry(registryPath)
        : { sources: [] };

      config.sources.push({
        url,
        skill_name: cli.commandOpts.skillName
          ? normalizeSkillName(cli.commandOpts.skillName)
          : null,
        root_dir: cli.commandOpts.rootDir || null,
        source_base_url: cli.commandOpts.sourceBaseUrl || null,
        include: cli.commandOpts.include,
        exclude: cli.commandOpts.exclude,
      });

      await saveRegistry(registryPath, config);
      console.log(`Added source to registry: ${url}`);
      if (cli.commandOpts.skillName) {
        console.log(`  Skill name: ${normalizeSkillName(cli.commandOpts.skillName)}`);
      }
      if (cli.commandOpts.rootDir) {
        console.log(`  Root dir: ${cli.commandOpts.rootDir}`);
      }
      if (cli.commandOpts.sourceBaseUrl) {
        console.log(`  Source base URL: ${cli.commandOpts.sourceBaseUrl}`);
      }
      if (cli.commandOpts.include.length > 0) {
        console.log(`  Include: ${JSON.stringify(cli.commandOpts.include)}`);
      }
      if (cli.commandOpts.exclude.length > 0) {
        console.log(`  Exclude: ${JSON.stringify(cli.commandOpts.exclude)}`);
      }
      return;
    }

    case "list": {
      if (!(await fileExists(registryPath))) {
        throw new Error(
          `Registry file not found: ${registryPath}\nRun 'llmstxt-to-skills init' to create one.`
        );
      }

      const config = await loadRegistry(registryPath);
      if (config.sources.length === 0) {
        console.log("No sources in registry");
        return;
      }

      console.log(`Registry sources (${registryPath}):`);
      config.sources.forEach((source, i) => {
        console.log(`\n${i + 1}. ${source.url}`);
        if (source.skill_name) {
          console.log(`   Skill name: ${source.skill_name}`);
        }
        if (source.root_dir) {
          console.log(`   Root dir: ${source.root_dir}`);
        }
        if (source.source_base_url) {
          console.log(`   Source base URL: ${source.source_base_url}`);
        }
        if (source.include && source.include.length > 0) {
          console.log(`   Include: ${JSON.stringify(source.include)}`);
        }
        if (source.exclude && source.exclude.length > 0) {
          console.log(`   Exclude: ${JSON.stringify(source.exclude)}`);
        }
      });
      return;
    }

    case "update": {
      if (!(await fileExists(registryPath))) {
        throw new Error(
          `Registry file not found: ${registryPath}\nRun 'llmstxt-to-skills init' to create one.`
        );
      }

      const config = await loadRegistry(registryPath);
      if (config.sources.length === 0) {
        throw new Error("No sources in registry. Add sources with 'llmstxt-to-skills add <url>'");
      }

      const sourcesToUpdate = cli.commandOpts.source
        ? config.sources.filter((s) => s.url === cli.commandOpts.source)
        : config.sources;

      if (sourcesToUpdate.length === 0) {
        throw new Error("No matching sources found");
      }

      let totalSuccess = 0;
      let totalFailed = 0;

      for (const src of sourcesToUpdate) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`Updating from: ${src.url}`);
        console.log(`${"=".repeat(60)}`);

        if (fsSync.existsSync(outputDir)) {
          const entries = await fs.readdir(outputDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) {
              continue;
            }
            const skillDir = path.join(outputDir, entry.name);
            const metadata = await readMetadata(skillDir);
            if (metadata && metadata.source_url === src.url) {
              console.log(`Removing old skill: ${skillDir}`);
              await fs.rm(skillDir, { recursive: true, force: true });
            }
          }
        }

        const { success, failed } = await generateFromSource(
          src.url,
          outputDir,
          src.include || [],
          src.exclude || [],
          src.skill_name || null,
          src.root_dir || null,
          src.source_base_url || null
        );
        totalSuccess += success;
        totalFailed += failed;
      }

      console.log(`\n${"=".repeat(60)}`);
      console.log("Update Summary:");
      console.log(`  Successfully generated: ${totalSuccess} skills`);
      console.log(`  Failed: ${totalFailed} skills`);
      console.log(`  Output directory: ${outputDir}`);
      console.log(`${"=".repeat(60)}`);

      if (totalSuccess > 0) {
        console.log("\nGenerated skills are ready to copy into your agent skill directory.");
      }
      return;
    }

    default: {
      const sourceUrl = cli.global.url || cli.commandOpts.positionals[0] || null;
      if (!sourceUrl) {
        throw new Error(
          "No URL provided. Use 'llmstxt-to-skills --url <url>' or see 'llmstxt-to-skills --help'"
        );
      }

      const { success, failed } = await generateFromSource(
        sourceUrl,
        outputDir,
        cli.global.include,
        cli.global.exclude,
        cli.global.skillName,
        cli.global.rootDir,
        cli.global.sourceBaseUrl
      );

      console.log(`\n${"=".repeat(60)}`);
      console.log("Summary:");
      console.log(`  Successfully generated: ${success} skills`);
      console.log(`  Failed: ${failed} skills`);
      console.log(`  Output directory: ${outputDir}`);
      console.log(`${"=".repeat(60)}`);

      if (success > 0) {
        console.log("\nGenerated skills are ready to copy into your agent skill directory.");
      }
    }
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  runCli,
  parseArgs,
  parseLlmsTxt,
  applyFilters,
  extractDomainName,
  normalizeSkillName,
  entryTitleToFilename,
  getRegistryPath,
  loadRegistryFromText,
  registryToToml,
};
