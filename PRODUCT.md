# Product

## Register

product

## Users

A single developer running this tool locally on their own machine, usually in a dark room late at night while actively writing code with Codex. They glance at the dashboard between tasks to check remaining quota and see when the window resets. No onboarding needed; no other users.

## Product Purpose

A local monitoring dashboard that reads Codex / ChatGPT rate-limit quota windows via the official `codex app-server` JSON-RPC surface. It tells you how much quota you have left in each time window and when it resets. Success means the developer can answer "am I near the limit?" in one glance.

## Brand Personality

Precise, terminal-native, polished.

The tool lives beside the editor and the terminal. It should feel native to that context, not like a web app that wandered in. Terse labels, crisp data, no handholding.

## Anti-references

- **Obsidian-style chaos**: too many panels, too much density, everything competing for attention. This tool has one job; it should look like it.
- **Generic SaaS dashboards**: hero-metric grids, gradient cards, repeated icon-heading-stat columns. Those templates exist for marketing; this is a personal developer instrument.

## Design Principles

1. **Signal over noise.** Surface only what matters right now: quota remaining and reset time. Decoration is debt.
2. **Terminal confidence.** Tight, monospaced, dark. Feels like it belongs next to the shell, not in a browser tab opened by accident.
3. **Color as status, not decoration.** Green, yellow, and red communicate quota health. They are the only reason for color. Everything else is near-neutral.
4. **Calm urgency.** When limits are critical, the UI says so clearly but without alarm. Weight and hue do the work; no stacked alerts, no blinking.
5. **One screen, read at a glance.** No tabs, no drawers, no navigation. The full picture fits in the viewport without scrolling on a typical laptop.
6. **Window time signals remaining opportunity, not reset countdown.** The window time bar shows how long the developer has left to spend quota in the current window. Time running low is an urgency signal: quota not yet used will be lost when the window closes. The reset countdown (when the window refills) is a secondary concern, relevant only when quota is depleted or critically low.

## Accessibility & Inclusion

No formal WCAG level required (personal local tool). Maintain reasonable contrast so the dashboard is readable in a dim room. Status colors (success/warning/destructive) must not rely on color alone; label text accompanies every bar.
