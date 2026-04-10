#!/usr/bin/env bun
/**
 * crew-themes MCP server.
 *
 * Registry of Crew pane background themes. Themes live in separate repos
 * (one per theme) pinned to specific commit SHAs. Images are downloaded
 * on demand rather than bundled, keeping this plugin small.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, rmSync, mkdirSync, statSync, readdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;
const REGISTRY_PATH = join(PLUGIN_ROOT, "registry.json");
const INSTALL_DIR = join(process.env.HOME ?? "/tmp", ".wire", "themes");
const CLONE_CACHE = join(process.env.HOME ?? "/tmp", ".wire", "theme-cache");

type RegistryEntry = {
  name: string;
  description: string;
  author: string;
  repo: string;
  commit: string;
  default?: boolean;
};

type Registry = {
  version: number;
  themes: RegistryEntry[];
};

/** Strict 40-char lowercase hex SHA1. No tags, no refs, no branch names. */
const FULL_SHA_RE = /^[0-9a-f]{40}$/;

function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) return { version: 1, themes: [] };
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Registry;
  // Validate every entry pins a proper commit SHA. Tags and refs not allowed.
  for (const t of reg.themes) {
    if (!FULL_SHA_RE.test(t.commit)) {
      throw new Error(
        `Registry entry for '${t.name}' has invalid commit '${t.commit}'. ` +
        `Must be a full 40-char hex SHA (no tags, no refs, no branch names).`,
      );
    }
  }
  return reg;
}

function findEntry(name: string): RegistryEntry | null {
  const reg = loadRegistry();
  return reg.themes.find((t) => t.name === name) ?? null;
}

function themeStatus(name: string): "installed" | "available" | "unknown" {
  if (existsSync(join(INSTALL_DIR, name, "theme.json"))) return "installed";
  if (findEntry(name)) return "available";
  return "unknown";
}

function copyDirRecursive(src: string, dst: string): number {
  mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    if (entry.startsWith(".")) continue; // skip .git etc
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      count += copyDirRecursive(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
      count++;
    }
  }
  return count;
}

/**
 * Shallow-fetch a specific commit from a theme repo and copy the contents
 * into ~/.wire/themes/<name>/. Refuses to install unless:
 *   - The registry entry pins a full 40-char hex commit SHA (no tags/refs)
 *   - The remote actually has that commit (not force-pushed away)
 *   - The fetched HEAD matches the requested SHA exactly
 */
function installTheme(entry: RegistryEntry): { files: number; commit: string; path: string } {
  // Enforce content-hash pinning. Tags and refs are rejected.
  if (!FULL_SHA_RE.test(entry.commit)) {
    throw new Error(
      `Registry entry for '${entry.name}' does not pin a full commit SHA. ` +
      `Got '${entry.commit}' — must be 40 lowercase hex chars. Tags and refs are not allowed.`,
    );
  }

  mkdirSync(CLONE_CACHE, { recursive: true });
  const clonePath = join(CLONE_CACHE, entry.name);
  if (existsSync(clonePath)) rmSync(clonePath, { recursive: true, force: true });
  mkdirSync(clonePath, { recursive: true });

  const git = (...args: string[]) => spawnSync("git", ["-C", clonePath, ...args], { stdio: "pipe" });

  // Bare init + shallow fetch of the exact commit
  let res = git("init", "--quiet");
  if (res.status !== 0) throw new Error(`git init failed: ${res.stderr?.toString()}`);

  res = git("remote", "add", "origin", `https://github.com/${entry.repo}.git`);
  if (res.status !== 0) throw new Error(`git remote add failed: ${res.stderr?.toString()}`);

  // Fetch only the exact commit at depth 1
  res = git("fetch", "--depth=1", "--quiet", "origin", entry.commit);
  if (res.status !== 0) {
    throw new Error(
      `Pinned commit ${entry.commit.slice(0, 8)} not found in ${entry.repo}. ` +
      `The theme repo may have been force-pushed. Refusing to install. ` +
      `(git fetch: ${res.stderr?.toString().trim()})`,
    );
  }

  // Checkout FETCH_HEAD (which is the commit we fetched)
  res = git("checkout", "--quiet", "FETCH_HEAD");
  if (res.status !== 0) throw new Error(`git checkout failed: ${res.stderr?.toString()}`);

  // Paranoid verification
  res = git("rev-parse", "HEAD");
  const actualSha = res.stdout?.toString().trim();
  if (actualSha !== entry.commit) {
    throw new Error(`Commit mismatch: expected ${entry.commit}, got ${actualSha}`);
  }

  const dst = join(INSTALL_DIR, entry.name);
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  const fileCount = copyDirRecursive(clonePath, dst);
  rmSync(clonePath, { recursive: true, force: true });

  return { files: fileCount, commit: actualSha, path: dst };
}

function uninstallTheme(name: string): boolean {
  const path = join(INSTALL_DIR, name);
  if (!existsSync(path)) return false;
  rmSync(path, { recursive: true, force: true });
  return true;
}

const mcp = new Server(
  { name: "crew-themes", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Crew pane background themes. Browse with theme_search, install with " +
      "theme_install, remove with theme_uninstall, preview with theme_preview. " +
      "Themes live in separate repos pinned to specific commit SHAs for " +
      "content integrity.\n\n" +
      "Want to make your own theme? SUPER EASY — just say 'build me a theme " +
      "about <topic>' and a background agent fetches images, picks per-pane " +
      "badge colors with dual-contrast analysis, and writes theme.json for " +
      "you. Use theme_submit to contribute it back.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "theme_search",
      description: "List all themes in the registry with install status.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Optional filter — matches name, description, or author" },
        },
      },
    },
    {
      name: "theme_preview",
      description: "Show details about a theme: description, author, repo, commit, install status, pool names if installed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Theme name" },
        },
        required: ["name"],
      },
    },
    {
      name: "theme_install",
      description: "Install a theme by name. Clones the theme repo, checks out the pinned commit SHA (refuses if the commit was force-pushed away), and copies images into ~/.wire/themes/<name>/.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Theme name from the registry" },
        },
        required: ["name"],
      },
    },
    {
      name: "theme_uninstall",
      description: "Remove an installed theme from ~/.wire/themes/. Does not affect the registry.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Theme name" },
        },
        required: ["name"],
      },
    },
    {
      name: "theme_build",
      description: "Build a new theme from a topic. Spawns a background Sonnet agent that fetches 20 background images, picks per-pane badge colors with dual-contrast analysis, and writes theme.json. SUPER EASY.",
      inputSchema: {
        type: "object" as const,
        properties: {
          topic: { type: "string", description: "Theme topic (e.g. 'mountains', 'vintage cars', 'jazz instruments')" },
        },
        required: ["topic"],
      },
    },
    {
      name: "theme_submit",
      description: "Submit a local theme to the public registry. Instructions for forking agiterra/crew-themes, creating a new theme repo, and opening a PR with the registry entry.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Local theme name (must exist in ~/.wire/themes/)" },
          description: { type: "string", description: "Short description for the registry" },
          author: { type: "string", description: "Your name or handle" },
        },
        required: ["name", "description", "author"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;

    switch (name) {
      case "theme_search": {
        const query = (a.query as string | undefined)?.toLowerCase();
        const reg = loadRegistry();
        const matches = query
          ? reg.themes.filter((t) =>
              t.name.toLowerCase().includes(query) ||
              t.description.toLowerCase().includes(query) ||
              t.author.toLowerCase().includes(query),
            )
          : reg.themes;
        result = matches.map((t) => ({
          name: t.name,
          description: t.description,
          author: t.author,
          repo: t.repo,
          commit: t.commit.slice(0, 8),
          default: t.default ?? false,
          status: themeStatus(t.name),
        }));
        break;
      }

      case "theme_preview": {
        const themeName = a.name as string;
        const entry = findEntry(themeName);
        if (!entry) throw new Error(`theme '${themeName}' not in registry`);

        const preview: Record<string, unknown> = {
          name: entry.name,
          description: entry.description,
          author: entry.author,
          repo: entry.repo,
          commit: entry.commit,
          status: themeStatus(themeName),
        };

        // If installed, include pool info
        const installedPath = join(INSTALL_DIR, themeName, "theme.json");
        if (existsSync(installedPath)) {
          const theme = JSON.parse(readFileSync(installedPath, "utf-8"));
          preview.pool = theme.pool;
          preview.image_count = Object.keys(theme.background?.images ?? {}).length;
          preview.badge_color_count = Object.keys(theme.badgeColors ?? {}).length;
        }

        result = preview;
        break;
      }

      case "theme_install": {
        const themeName = a.name as string;
        const entry = findEntry(themeName);
        if (!entry) throw new Error(`theme '${themeName}' not in registry`);
        result = installTheme(entry);
        break;
      }

      case "theme_uninstall": {
        const themeName = a.name as string;
        const removed = uninstallTheme(themeName);
        result = removed
          ? { uninstalled: themeName }
          : { error: `theme '${themeName}' was not installed` };
        break;
      }

      case "theme_build": {
        const topic = a.topic as string;
        result = {
          message:
            `To build a theme about '${topic}', use the theme-build skill with a background Sonnet agent. ` +
            `The skill handles image search, download, per-pane badge color selection with dual-contrast ` +
            `analysis, and theme.json generation.`,
          topic,
          skill: "crew-themes:theme-build",
          invoke: `/crew-themes:theme-build ${topic}`,
        };
        break;
      }

      case "theme_submit": {
        const themeName = a.name as string;
        const localPath = join(INSTALL_DIR, themeName);
        if (!existsSync(join(localPath, "theme.json"))) {
          throw new Error(`local theme '${themeName}' not found at ${localPath}`);
        }
        result = {
          message: "To submit your theme to the public registry:",
          steps: [
            `1. Create a new repo: agiterra/crew-theme-${themeName}`,
            `2. Push ${localPath}/* to it`,
            `3. Fork agiterra/crew-themes`,
            `4. Add an entry to registry.json with { name, description, author, repo, commit }`,
            `5. Open a PR — we'll review and merge`,
          ],
          local_path: localPath,
          registry_entry_template: {
            name: themeName,
            description: a.description,
            author: a.author,
            repo: `agiterra/crew-theme-${themeName}`,
            commit: "<fill in after pushing>",
          },
        };
        break;
      }

      default:
        throw new Error(`unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text" as const, text: `error: ${e.message ?? String(e)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await mcp.connect(transport);
console.error(`[crew-themes] ready (plugin root: ${PLUGIN_ROOT})`);
