# Keyboard Navigation Design

## Philosophy

**Keyboard-first, not keyboard-only.** Every action in the application must be reachable without a mouse. Mouse interaction must never break. Experienced scorers — who will run the same workflow race after race — should be able to operate the application entirely from the keyboard and feel the difference.

**Context-sensitive shortcuts.** Shortcuts are scoped to the active view. A key that does one thing on the finish entry page does nothing (or something different) on the competitors page. This avoids conflicts and reduces cognitive load: the scorer only needs to know the shortcuts for what's in front of them.

**Discoverable, not hidden.** The `?` key opens a help overlay listing the active shortcuts for the current view. Shortcut hints appear in button tooltips. No inline hints clutter the UI on first load — keyboard support reveals itself on demand.

**Don't fight the browser.** Native tab order and focus management are used where possible. Custom shortcuts supplement, not replace, standard browser behaviour. Standard platform conventions (`Ctrl+S`/`Cmd+S` to save, `Escape` to dismiss) are respected.

---

## Core Scoring Workflow

The scorer's natural sequence for a racing series:

1. Open a series → land on Competitors tab
2. Add competitors (once per series, or updated as needed)
3. Switch to Races tab → add a race
4. Open the race → enter finish results
5. Switch to Standings tab to review

The keyboard model must support this flow without switching to the mouse at any point.

---

## Shortcut Reference

### Global (all views)

| Key | Action |
|-----|--------|
| `?` | Open keyboard shortcut help overlay |
| `g` `c` | Go to Competitors tab |
| `g` `r` | Go to Races tab |
| `g` `s` | Go to Standings tab |

The two-key chord (`g` then a letter within ~1 second) avoids accidental triggers in text inputs. The pattern is familiar from GitHub and Linear. Chords are inactive when focus is inside a text input or textarea.

### Competitors page

| Key | Action |
|-----|--------|
| `n` | Focus the Add Competitor form / open add dialog |
| `e` | Edit focused row (same as clicking the pencil icon) |
| `d` or `Delete` | Delete focused row (with confirmation) |

Row-level shortcuts (`e`, `d`) are only active when a competitor row has keyboard focus, not globally.

**Tab order:** sail number → helm name → club → gender → age → Save → Cancel

### Races page

| Key | Action |
|-----|--------|
| `n` | Add a new race |
| `Enter` | Open the focused race card |
| `d` or `Delete` | Delete the focused race (with confirmation) |

### Finish entry page

| Key | Context | Action |
|-----|---------|--------|
| `Tab` / `Enter` | Sail number input, autocomplete visible | Select highlighted suggestion |
| `ArrowDown` / `ArrowUp` | Sail number input, autocomplete visible | Move through suggestions |
| `Escape` | Sail number input, autocomplete visible | Clear input and dismiss suggestions |
| `Enter` | Position number field | Commit edit |
| `Escape` | Position number field | Cancel edit |
| `Tab` | Anywhere on page | Move to next focusable element (see tab order below) |
| `Ctrl+S` / `Cmd+S` | Anywhere on page | Save results |
| `Escape` | No modal open, no active input | Navigate back to races list |

**Tab order:** sail number input → finisher position fields (top to bottom) → non-finisher result code dropdowns → Save → Cancel

Non-finisher result code dropdowns use Radix UI Select, which handles `ArrowDown`/`ArrowUp`/`Enter`/`Escape` internally once opened. The `Tab` key reaches the dropdown; `Enter` or `Space` opens it.

### Modals and dialogs

| Key | Action |
|-----|--------|
| `Escape` | Close dialog (Radix UI default behaviour) |
| `Tab` | Move between fields within the dialog |
| `Enter` | Submit form (when focus is on a field or the Submit button) |

---

## Escape Key Hierarchy

`Escape` follows a layered dismissal model:

1. If an autocomplete dropdown is open → dismiss the dropdown
2. If a modal/dialog is open → close the dialog
3. If on the finish entry page with no modal → navigate back to races list
4. Otherwise → no action

---

## Focus Management

- When a dialog opens, focus moves to the first field automatically
- When a dialog closes, focus returns to the element that triggered it
- When a new race or competitor is added successfully, focus returns to the triggering button or the first field of a new empty form, depending on context
- Finish entry: on page load, focus is placed on the sail number input

---

## Discoverability

- `?` opens a modal cheat sheet scoped to the current page. The overlay groups shortcuts by context and closes on `Escape` or clicking outside.
- Button tooltips include shortcut hints where space allows (e.g., `Save (⌘S)`).
- The help overlay is the single source of truth for shortcut documentation; shortcuts are not described inline in the UI.

---

## Out of Scope

- The Standings page is read-only; keyboard navigation there is limited to standard tab/scroll behaviour.
- Drag-and-drop reordering of finishers is not in scope for keyboard; position numbers are editable directly.
- Mobile / touch interaction is a separate concern; keyboard design should not compromise touch usability.
