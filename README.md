# Gradescope Code Navigator

A Chrome extension for TAs and graders who grade programming submissions on Gradescope. Give it a list of files and methods (as regular expressions), then press one key to step through them. It opens each file, scrolls to the method, and highlights it, so you stop hunting through every submission for the same few methods.

> **Unofficial.** This project is not affiliated with or endorsed by Gradescope or Turnitin.

## What it does

You write a list like this:

```
^WindowStack\.java
-- Node<Window> getTop\(\)
-- void add\(Window
^Window\.java
-- void sortCreation\(\)
```

Then, on a Gradescope grading page, each press of `\` does the next thing in the list:

| Press | What happens |
| --- | --- |
| 1 | Opens `WindowStack.java` and jumps to `getTop()` |
| 2 | Jumps to `add(Window` in the same file |
| 3 | Closes `WindowStack.java`, opens `Window.java`, jumps to `sortCreation()` |
| 4 | Closes `Window.java`, reopens `WindowStack.java`, jumps to `getTop()` again |

The list loops forever. The matched code is highlighted, and a small toast in the bottom-right corner shows where you are (for example `[2/3] WindowStack.java › void add\(Window`).

If you close a file by hand, the next press reopens it. When you move to another submission, the list starts over from the first step.

## Install

This is an unpacked extension, so it isn't on the Chrome Web Store. It works in Chrome and other Chromium browsers (Edge, Brave, Arc).

1. **Get the code.** Either click **Code → Download ZIP** on this page and unzip it, or run:
   ```
   git clone <this-repo-url>
   ```
2. Open `chrome://extensions` (in Edge, `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Click the puzzle-piece icon in the toolbar and pin **Gradescope Code Navigator** so it's easy to reach.
6. **Refresh any Gradescope tabs that were already open.** Chrome only injects the extension into pages loaded after it was installed or updated.

### Updating

Download or `git pull` the new version, go to `chrome://extensions`, click the reload arrow on the extension's card, then refresh your Gradescope tab.

## Set it up

1. Click the extension's toolbar icon.
2. Paste your list into the big text box (or click **Load example** to see the format).
3. Click **Save**. You should see something like `Saved: 2 files, 3 steps`.
4. Open a grading page and press `\`.

Settings are saved in your browser and stay there between sessions. Change the list whenever the assignment changes.

### List format

- A line **without** a `--` prefix is a **filename regex**. It's matched against the submission's file paths.
- A line starting with `--` is a **method regex** for the file above it. It's matched against the code that is currently visible.
- Blank lines and lines starting with `#` are ignored.
- A file with no `--` lines is just opened, with no jump.
- Steps run in the order written.

### Regex tips

- **Anchor your filenames.** `CircularArray\.java` also matches `PriorityCircularArray.java`, because one is a substring of the other. Use `^CircularArray\.java$` instead.
- **Be specific with methods.** The extension jumps to the *first* match in the file, and that could be a Javadoc comment or a call site. `remove\(` might land on a comment; `E remove\(int` lands on the declaration.
- **Escape parentheses and dots:** `\(`, `\)`, `\.`. Angle brackets (`<` `>`) don't need escaping.
- Filenames are case-insensitive by default; methods are case-sensitive. To set your own flags, wrap the pattern as `/pattern/flags`, for example `/void add\(window/i`.
- Method patterns are matched against the code text with the multiline flag on, so `^` and `$` match at line starts and ends.

### Other settings

- **Hotkey:** the key that advances the list (default `\`). It's ignored while you're typing in a comment box, rubric field, or any text input.
- **Code container selector (optional):** a CSS selector for the code viewer. Leave it blank unless the extension is searching the wrong part of the page (for example, matching text in the rubric instead of the code).
- **Enabled:** turns the extension on or off without removing your list.

## Troubleshooting

Look at the toast in the bottom-right corner when you press the hotkey.

| What you see | What it means |
| --- | --- |
| Nothing at all | The extension isn't running on this page. Refresh the Gradescope tab, and check the extension is enabled at `chrome://extensions`. Open DevTools (F12) → Console and look for `[GS Nav] loaded`. |
| *No files configured* | Nothing is saved. Open the popup, paste your list, and click **Save**. |
| *Config error: …* | One of your regexes is invalid. The popup also shows this when you click Save. |
| *couldn't find the file header on the page* | The file name wasn't found on the page. Check your filename regex against the submission's actual file names. |
| *no match in the visible code* | The file opened, but your method regex didn't match any visible code. Check the signature as it appears in the student's code. |

If it still doesn't work, send us a diagnostics report (next section).

## Reporting an issue

Gradescope can change its page layout, and this extension finds things on the page by looking at its structure, so it can break. A diagnostics report is the fastest way to get a fix.

1. Open the Gradescope grading page where the problem happens.
2. Press **Ctrl + `\`** (hold Control and press the backslash key). If you changed the hotkey, use Ctrl plus your hotkey.
3. A toast says *Diagnostics copied to clipboard*. If the clipboard is blocked, the report is printed to the browser console instead (F12 → Console).
4. Paste the report into a new GitHub issue.

The report includes:

- the extension's view of your saved list,
- the file paths Gradescope gave the page,
- the page elements it found for each filename, with a snippet of their HTML,
- the code area it detected, with the first few hundred characters of the code text,
- the CSS class names used in the grading panel.

**Check the report before posting it publicly.** It includes the page URL (which contains course and submission IDs) and a short sample of the student's code. If you're grading non-anonymously, scan it for student names. Delete anything you don't want public. The `code text sample` line is the one most likely to need editing.

Please also include:

- what you pressed and what you expected to happen,
- what actually happened, including the toast message,
- your list (the text in the popup),
- your browser and version, and the extension version (shown on its `chrome://extensions` card).

## Privacy

- The extension asks for one permission, `storage`, to keep your list and settings in your browser.
- It runs only on `https://www.gradescope.com/*`.
- It makes no network requests and sends no data anywhere. The diagnostics report is copied to *your* clipboard and nothing is uploaded automatically.

## How it works

- `content.js` runs on Gradescope pages. It reads your saved list, listens for the hotkey, clicks file headers to open and close files, and searches the visible code text for your regex. It highlights the match with the browser's CSS Custom Highlight API, so it doesn't modify the page's DOM.
- `popup.html` and `popup.js` are the settings popup.
- `manifest.json` is the Manifest V3 definition.

## Known limitations

- It finds files and code by inspecting the page's structure and text, not through an official Gradescope API, so a Gradescope redesign may require an update.
- Highlighting uses the CSS Custom Highlight API, which needs Chrome 105 or newer. On older versions it falls back to an outline.
- If a file's open or closed state isn't visible in the page, the extension tracks it itself and corrects by retrying once, so you may occasionally see a brief flicker.
- It has been tried on text-file (programming) assignments with Java files. Other languages should work since matching is regex over code text, but they haven't been tested as much.

## Credits

This extension was generated by **Claude Sonnet 5.5** (Anthropic) on **medium effort** in **October 2026**. It was then refined through testing on live Gradescope grading pages.
