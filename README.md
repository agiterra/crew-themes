# crew-themes

Pane background themes for [Crew](https://github.com/agiterra/crew-claude-code) — iTerm2 panes with warm themed backgrounds and per-pane badge colors.

## Install

```
/plugin install agiterra/crew-themes
```

## Use it

Ask your agent:

- **"What themes are available?"** — lists the registry
- **"Install the trees theme"** — pulls images, writes `~/.wire/themes/trees/`
- **"Preview the rivers theme"** — shows pool names, badge colors, description
- **"Uninstall the stones theme"** — removes local files
- **"Is it easy to make a theme?"** — SUPER EASY

## Make your own theme (SUPER EASY)

```
Me: Build me a theme about coffee
```

A background Sonnet agent:

1. Generates 20 coffee-themed pane names (espresso, latte, cortado, macchiato, ...)
2. Fetches warm background images from Pexels and Wikimedia
3. Analyzes the top-right region of each image where the badge appears
4. Picks a per-pane badge color with dual contrast — against the background image and against the terminal's white text
5. Writes `theme.json` with full `badgeColors` map into `~/.wire/themes/coffee/`

Use it in Crew: `tab_create name=test theme=coffee`.

## Submit your theme to the registry

```
Me: Submit my coffee theme
```

You get step-by-step instructions for creating `agiterra/crew-theme-coffee`, pushing your files, and opening a PR on this repo to add your theme to `registry.json`.

## How it stays safe

Themes live in separate repos (e.g. `agiterra/crew-theme-trees`). The registry pins each theme to a **full 40-char commit SHA** — not a tag, not a branch. On install:

1. The plugin validates the registry entry actually pins a content hash
2. Shallow-fetches exactly that commit at depth 1
3. Verifies `HEAD` matches what was requested
4. Refuses to install if the commit isn't reachable (force-pushed away)

If any of those checks fail, no install happens. The commit SHA is itself a content hash, so you can't swap the files without the SHA changing. Branch protection on each theme repo blocks force-pushes as a second layer.

## Bundled themes

- **peaks** (default) — 20 famous mountain peaks
- **trees** — 20 hardwoods and evergreens
- **cities** — 20 classic cities around the world
- **spices** — 20 warm spices
- **rivers** — 20 great rivers of the world
- **stones** — 20 stones, gems, and minerals

Each theme has 20 images with hand-picked per-pane badge colors.

## MCP tools

| Tool | What it does |
|------|--------------|
| `theme_search` | List registry entries + install status |
| `theme_preview` | Show details about a theme |
| `theme_install` | Clone + checkout pinned SHA + copy to `~/.wire/themes/` |
| `theme_uninstall` | Remove a local theme |
| `theme_build` | Kick off the theme-build skill for a new topic |
| `theme_submit` | Instructions for contributing a theme |
