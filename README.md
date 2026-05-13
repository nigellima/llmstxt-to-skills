# llmstxt-to-skills

Parses `llms.txt` files and generates agent skills with YAML frontmatter and reference documentation.

This project is a Node.js CLI adaptation of the original Rust library by Josh Jarabek:
https://github.com/JoshJarabek7/llmstxt-to-skills

The goal of this version is to make the workflow easy to run from the JavaScript
tooling most agent and documentation projects already have available. Instead of
cloning a repository and setting up a Rust toolchain, you can run it directly with
`npx`, `pnpm dlx`, or `yarn dlx` and generate skills in one command.

This version also adds support for custom generated skill names and local
`llms.txt` file paths, so you can generate skills from either a published docs
site or a freshly built local documentation artifact.

## What this does

Takes a URL or local file path to an `llms.txt` file, reads all linked markdown documentation, and generates one agent skill per source. By default the generated skill name comes from the source domain for URLs or the local file name for file paths, but you can override it with `--skill-name`. The skill includes a comprehensive `SKILL.md` with a table of contents and a `references/` directory containing the documentation as individual markdown files.

## Usage

Run without installing:

```bash
npx llmstxt-to-skills https://docs.anthropic.com/llms.txt
pnpm dlx llmstxt-to-skills https://docs.anthropic.com/llms.txt
yarn dlx llmstxt-to-skills https://docs.anthropic.com/llms.txt
```

You can also use the explicit `--url` form:

```bash
npx llmstxt-to-skills --url https://docs.anthropic.com/llms.txt
```

This creates skills in `./skills/` by default.

Generate from a local `llms.txt` file:

```bash
npx llmstxt-to-skills ./build/llms.txt --skill-name my-docs
pnpm dlx llmstxt-to-skills ./build/llms.txt --skill-name my-docs
```

Relative links inside a local `llms.txt` are resolved from that file's directory, so a link like `./getting-started.md` reads the neighboring local markdown file.

If your local `llms.txt` contains root-relative links such as `/guide/getting-started.md`, pass the documentation source root explicitly:

```bash
npx llmstxt-to-skills ./build/llms.txt \
  --skill-name my-docs \
  --root-dir ./docs-site
```

Custom skill name:

```bash
npx llmstxt-to-skills https://docs.anthropic.com/llms.txt --skill-name anthropic-docs
```

The generated directory name and the `name:` field in `SKILL.md` will use `anthropic-docs` instead of the default domain-derived name.

Custom output directory:

```bash
npx llmstxt-to-skills https://docs.anthropic.com/llms.txt --output-dir ~/my-skills
```

Filter which entries to process:

```bash
# Only generate skills from API documentation
npx llmstxt-to-skills https://docs.anthropic.com/llms.txt --include '*/api/*'

# Skip admin API documentation
npx llmstxt-to-skills https://docs.anthropic.com/llms.txt --exclude '*/admin-api/*'

# Combine filters
npx llmstxt-to-skills https://docs.anthropic.com/llms.txt \
  --include '*/api/*' \
  --exclude '*/admin-api/*'
```

## Registry Mode

For managing multiple documentation sources and keeping skills up to date, use the registry feature.

### Initialize a registry

```bash
npx llmstxt-to-skills init
```

Creates `.agent-skills-registry.toml` in the current directory with an empty sources list.

### Add sources to registry

```bash
# Add a source without filters
npx llmstxt-to-skills add https://docs.anthropic.com/llms.txt

# Add a local source
npx llmstxt-to-skills add ./build/llms.txt \
  --skill-name local-docs \
  --root-dir ./docs-site

# Add a source with a custom generated skill name
npx llmstxt-to-skills add https://docs.anthropic.com/llms.txt \
  --skill-name anthropic-docs

# Add a source with filters
npx llmstxt-to-skills add https://docs.anthropic.com/llms.txt \
  --include '*/api/*' \
  --exclude '*/admin-api/*'

# Add another source
npx llmstxt-to-skills add https://other-docs.com/llms.txt
```

### List registered sources

```bash
npx llmstxt-to-skills list
```

Shows all sources in the registry with their filters.

### Update skills from registry

```bash
# Update all sources
npx llmstxt-to-skills update

# Update only one source
npx llmstxt-to-skills update --source https://docs.anthropic.com/llms.txt
```

The `update` command:

1. Scans the output directory for skill directories
2. Checks `.metadata.json` in each to find matching source URLs
3. Deletes the entire skill directory for sources being updated
4. Fetches fresh documentation from the `llms.txt` source
5. Generates a new skill with all current references

This ensures you always have current documentation without manually tracking what came from where. Since each source generates exactly one skill directory, updates are straightforward.

### Registry file format

`.agent-skills-registry.toml`:

```toml
[[source]]
url = "https://docs.anthropic.com/llms.txt"
skill_name = "anthropic-docs"
include = ["*/api/*"]
exclude = ["*/admin-api/*"]

[[source]]
url = "https://other-docs.com/llms.txt"

[[source]]
url = "./build/llms.txt"
skill_name = "local-docs"
root_dir = "./docs-site"
```

### Metadata tracking

Each generated skill includes `.metadata.json`:

```json
{
  "source_url": "https://docs.example.com/llms.txt",
  "skill_name": "docs-example-com",
  "entry_count": 127,
  "sections": ["Getting Started", "API Reference", "Guides", "Examples"],
  "generated_at": "2025-01-18T10:30:00Z",
  "generator_version": "1.1.1"
}
```

This allows `update` to identify which skills to regenerate. Since each source generates exactly one skill, the update process simply deletes the matching generated directory and regenerates it.

## Using generated skills

Copy the generated skill directories into whatever location your agent runtime expects for local or project-scoped skills. The exact install path depends on the agent you are using.

Example:

```bash
cp -r ./skills/* /path/to/your/agent/skills/
```

Each source generates one skill directory, such as `docs-example-com/` or a custom override like `anthropic-docs/`, so you can manage and update individual documentation sources easily.

## How it works

1. Reads the `llms.txt` file from the provided URL or local path
2. Parses the complete structure: H1 title, blockquote summary, and H2 sections with entries
3. Resolves root-relative local links against `--root-dir`, when provided
4. Derives a skill name from the URL domain or local file name, unless `--skill-name` is provided
5. Reads markdown content from each linked entry
6. Generates a single skill directory per source:
   - `SKILL.md` with YAML frontmatter, overview, and an organized table of contents linking to all references
   - `references/` with one markdown file per entry
   - `.metadata.json` with tracking info for registry updates

### Example generated structure

```text
skills/
└── docs-example-com/
    ├── SKILL.md
    ├── .metadata.json
    └── references/
        ├── getting_started.md
        ├── creating_messages.md
        ├── streaming_responses.md
        └── ...
```

The `SKILL.md` file organizes all references by their original H2 sections from `llms.txt`, making the documentation easy to navigate.

## llms.txt format

Expects markdown lists with links:

```markdown
# Section Name

- [Entry Title](https://example.com/doc.md)
- [Another Entry](https://example.com/other.md): Optional description
- [Third Entry](./relative/path.md): Descriptions are used in skill metadata
```

Relative URLs and local paths are resolved based on the `llms.txt` file location.

## Performance

Uses a single HTTP client with connection pooling. Large documentation sets should process reasonably fast unless the source server is rate limiting.

## Requirements

- Node.js 18 or later
- Internet connection for fetching remote documentation sources

## Local development

```bash
npm test
npm run smoke:help
```

## Troubleshooting

**`npx` or `npm` not found:**
Install Node.js from https://nodejs.org/

**Network errors:**
Check that the URL is accessible. Some documentation sites may require authentication or may be rate limited.

**Generated skills are not loading in your agent:**
- Verify the installation location for that agent
- Check the YAML frontmatter in generated `SKILL.md` files
- Restart the agent runtime if needed

## License

MIT
