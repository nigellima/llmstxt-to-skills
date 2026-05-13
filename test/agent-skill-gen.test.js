"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {
  runCli,
  parseArgs,
  parseLlmsTxt,
  applyFilters,
  normalizeSkillName,
  entryTitleToFilename,
  getRegistryPath,
  loadRegistryFromText,
  registryToToml,
} = require("../agent-skill-gen.js");

test("parseArgs supports positional URL usage", () => {
  const cli = parseArgs([
    "https://example.com/llms.txt",
    "--include",
    "*/api/*",
    "--exclude=*/admin/*",
  ]);

  assert.equal(cli.command, null);
  assert.equal(cli.global.url, null);
  assert.deepEqual(cli.global.include, ["*/api/*"]);
  assert.deepEqual(cli.global.exclude, ["*/admin/*"]);
  assert.deepEqual(cli.commandOpts.positionals, ["https://example.com/llms.txt"]);
});

test("parseArgs supports custom skill names in standalone and registry add modes", () => {
  const standalone = parseArgs([
    "https://example.com/llms.txt",
    "--skill-name",
    "Custom Docs",
  ]);
  assert.equal(standalone.global.skillName, "Custom Docs");

  const registryAdd = parseArgs([
    "add",
    "https://example.com/llms.txt",
    "--skill-name=Custom Docs",
  ]);
  assert.equal(registryAdd.command, "add");
  assert.equal(registryAdd.commandOpts.skillName, "Custom Docs");
});

test("parseLlmsTxt resolves relative URLs and captures sections", () => {
  const parsed = parseLlmsTxt(
    [
      "# Example Docs",
      "",
      "> Summary line",
      "",
      "## Guides",
      "- [Intro](./intro.md): Start here",
      "- [API](https://example.com/api.md)",
    ].join("\n"),
    "https://example.com/docs/llms.txt"
  );

  assert.equal(parsed.title, "Example Docs");
  assert.equal(parsed.summary, "Summary line");
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0][0], "Guides");
  assert.deepEqual(parsed.sections[0][1][0], {
    title: "Intro",
    url: "https://example.com/docs/intro.md",
    description: "Start here",
    section: "Guides",
  });
});

test("applyFilters honors include and exclude globs", () => {
  const entries = [
    { url: "https://example.com/api/messages.md" },
    { url: "https://example.com/api/admin/users.md" },
    { url: "https://example.com/guides/setup.md" },
  ];

  const filtered = applyFilters(entries, ["*/api/*"], ["*/admin/*"]);
  assert.deepEqual(filtered, [{ url: "https://example.com/api/messages.md" }]);
});

test("entryTitleToFilename sanitizes titles", () => {
  assert.equal(entryTitleToFilename("Button - Open Modal"), "button___open_modal.md");
  assert.equal(entryTitleToFilename("  "), "untitled.md");
});

test("normalizeSkillName sanitizes custom skill names", () => {
  assert.equal(normalizeSkillName("  My Custom.Skill / Name  "), "my-custom-skill-name");
  assert.throws(() => normalizeSkillName("!!!"), /Invalid skill name/);
});

test("getRegistryPath uses the default registry filename", async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "llmstxt-to-skills-registry-"));

  try {
    process.chdir(tempDir);
    assert.equal(getRegistryPath(), ".agent-skills-registry.toml");
    await fs.writeFile(".agent-skills-registry.toml", "");
    assert.equal(getRegistryPath(), ".agent-skills-registry.toml");
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("registry TOML preserves custom skill names", () => {
  const config = {
    sources: [
      {
        url: "https://docs.example.com/llms.txt",
        skill_name: "example-docs",
        include: ["*/api/*"],
        exclude: [],
      },
    ],
  };

  const toml = registryToToml(config);
  assert.match(toml, /skill_name = "example-docs"/);
  assert.deepEqual(loadRegistryFromText(toml), config);
});

test("runCli generates a generic agent skill without platform-specific text", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "llmstxt-to-skills-e2e-"));
  const docs = {
    "/llms.txt": [
      "# Example Product",
      "",
      "> Docs summary",
      "",
      "## Guides",
      "- [Getting Started](/docs/getting-started.md): Setup guide",
      "- [API](/docs/api.md)",
    ].join("\n"),
    "/docs/getting-started.md": "# Getting Started\n\nInstall it.",
    "/docs/api.md": "# API\n\nUse it.",
  };

  const server = http.createServer((req, res) => {
    const body = docs[req.url];
    if (!body) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/llms.txt`;

  try {
    await runCli([url, "--output-dir", tempDir]);

    const skillDir = path.join(tempDir, "127-0-0-1");
    const skillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
    const metadata = JSON.parse(
      await fs.readFile(path.join(skillDir, ".metadata.json"), "utf8")
    );

    assert.match(skillMd, /# Example Product/);
    assert.ok(
      !skillMd.includes("will automatically access relevant reference files based on your question")
    );
    assert.match(
      skillMd,
      /Use the table of contents below to locate the most relevant reference files/
    );
    assert.equal(metadata.source_url, url);
    assert.equal(metadata.entry_count, 2);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli uses custom skill names for output directory, metadata, and frontmatter", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "llmstxt-to-skills-custom-name-"));
  const docs = {
    "/llms.txt": [
      "# Example Product",
      "",
      "> Docs summary",
      "",
      "## Guides",
      "- [Getting Started](/docs/getting-started.md): Setup guide",
    ].join("\n"),
    "/docs/getting-started.md": "# Getting Started\n\nInstall it.",
  };

  const server = http.createServer((req, res) => {
    const body = docs[req.url];
    if (!body) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/llms.txt`;

  try {
    await runCli([url, "--output-dir", tempDir, "--skill-name", "Example Docs"]);

    const skillDir = path.join(tempDir, "example-docs");
    const skillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
    const metadata = JSON.parse(
      await fs.readFile(path.join(skillDir, ".metadata.json"), "utf8")
    );

    assert.match(skillMd, /^name: example-docs$/m);
    assert.equal(metadata.skill_name, "example-docs");
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli writes description as a double-quoted YAML scalar", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "llmstxt-to-skills-yaml-"));
  const docs = {
    "/llms.txt": [
      "# Example Product",
      "",
      '> Summary with "quoted" text',
      "",
      "## Guides",
      "- [Getting Started](/docs/getting-started.md): Setup guide",
    ].join("\n"),
    "/docs/getting-started.md": "# Getting Started\n\nInstall it.",
  };

  const server = http.createServer((req, res) => {
    const body = docs[req.url];
    if (!body) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/llms.txt`;

  try {
    await runCli([url, "--output-dir", tempDir]);

    const skillDir = path.join(tempDir, "127-0-0-1");
    const skillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");

    const descriptionLine = skillMd
      .split("\n")
      .find((line) => line.startsWith("description: "));
    assert.ok(descriptionLine, "description frontmatter line not found");
    assert.match(descriptionLine, /^description: ".*"$/);
    assert.ok(descriptionLine.includes('\\"quoted\\"'));
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCli update reuses registry custom skill names", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "llmstxt-to-skills-update-name-"));
  const registryPath = path.join(tempDir, ".agent-skills-registry.toml");
  const docs = {
    "/llms.txt": [
      "# Example Product",
      "",
      "> Docs summary",
      "",
      "## Guides",
      "- [Getting Started](/docs/getting-started.md): Setup guide",
    ].join("\n"),
    "/docs/getting-started.md": "# Getting Started\n\nInstall it.",
  };

  const server = http.createServer((req, res) => {
    const body = docs[req.url];
    if (!body) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/llms.txt`;

  try {
    await runCli([
      "add",
      url,
      "--registry",
      registryPath,
      "--skill-name",
      "Registry Docs",
    ]);
    await runCli(["update", "--registry", registryPath, "--output-dir", tempDir]);

    const skillDir = path.join(tempDir, "registry-docs");
    const metadata = JSON.parse(
      await fs.readFile(path.join(skillDir, ".metadata.json"), "utf8")
    );

    assert.equal(metadata.skill_name, "registry-docs");
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
