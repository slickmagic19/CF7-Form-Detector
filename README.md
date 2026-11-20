# CF7 Form Detector

A Chrome extension that detects **Contact Form 7** forms on the current page and gives you one-click access to each form in the WordPress admin. It is **Bedrock-aware**, so admin links point to the correct backend path on Roots Bedrock, subdirectory, and standard WordPress installs.

## Features

- **CF7 detection** — finds forms from `wpcf7-form`, `_wpcf7`, `_wpcf7_unit_tag`, and `data-wpcf7-id`, including forms added after page load.
- **Correct admin links** — builds `admin.php?page=wpcf7&post=<ID>&action=edit` using the detected WordPress core path.
- **Bedrock-aware** — reads `/app/themes/...` and `/wp/wp-includes/...` asset paths to derive the admin base (default Bedrock: `/wp/wp-admin/`).
- **Floating widget** — a small badge on pages with forms. Each form has **Edit**, **Focus**, and **Fill** actions.
- **Focus** — scrolls to a form and flashes a blue outline. Works even when the form is inside a hidden container (temporarily reveals it, then restores).
- **Popup dashboard** — lists all detected forms with admin URL, CF7 version, field count, and actions.
- **Real form titles** — looks up the title configured in WordPress via the CF7 REST API when you are logged in; falls back to nearby headings or the form ID.
- **Prefill test data** — fills first name, last name, email, phone, and message fields. Optionally auto-fills each form once on page load.
- **WordPress only** — does nothing and injects nothing on non-WordPress sites.
- **Always on top** — uses the Popover API (Chrome 114+) to render in the browser's top layer, above site widgets and high z-index elements. Falls back to max z-index on older Chrome.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `CF7-Form-Detector` folder.
5. Pin the extension to your toolbar.

There is no build step — load the folder directly.

## Usage

1. Open any page that contains a Contact Form 7 form.
2. Click the extension icon (or the floating CF7 badge).
3. For each form:
   - **Edit** — opens the form editor in the WordPress admin.
   - **Focus** — scrolls to the form and highlights it.
   - **Fill** — populates name, email, phone, and message fields.
4. **Fill all** in the popup fills every detected form at once.

The popup footer also links to the full CF7 forms list in the admin.

## Options

Open the extension options to configure:

| Setting | Description |
| --- | --- |
| **WordPress admin URL** | Override the auto-detected admin base. Use `/wp/wp-admin/` or a full URL. Leave blank for auto-detect. |
| **Prefill values** | First name, last name, email, phone, and message used by Fill. |
| **Enable prefill** | Shows Fill buttons in the popup and floating widget. |
| **Auto-fill forms on page load** | Fills each form once when it appears. Off by default. |
| **Look up real form titles** | Uses the CF7 REST API for exact titles (requires login with edit permission). |
| **Show floating CF7 badge** | Toggles the on-page widget. |
| **Open admin links in a new tab** | New-tab behavior for admin links. |

## How Bedrock detection works

Bedrock serves WordPress core from a subdirectory and content from `/app/`. The extension inspects asset paths:

- `/app/themes/...`, `/app/plugins/...`, `/app/uploads/...` → Bedrock content directory.
- `/wp/wp-includes/...` → WordPress core path (`/wp/`).
- Falls back to the RSD `xmlrpc.php` path or `wp-content` base when needed.

The admin URL is then built as:

```
<core>/wp-admin/admin.php?page=wpcf7&post=<ID>&action=edit
```

For a default Bedrock install this becomes:

```
https://example.com/wp/wp-admin/admin.php?page=wpcf7&post=123&action=edit
```

## Design system

The interface uses a design language adapted from Meta's [Astryx](https://github.com/meta/astryx) **Neutral** theme:

- **Typography:** Figtree (bundled locally) with a system-font fallback.
- **Surfaces:** quiet grayscale canvas (`#f1f1f1`) with white/dark cards and subtle borders.
- **Accent:** near-black in light mode, near-white in dark mode, with blue reserved for information states.
- **Semantic color:** success, warning, and error fills used only for their meanings.
- **Geometry:** 4px inner / 10px element / 12px container radii, pill controls.
- **Elevation:** soft low/med/high shadows, with a 1px light rim in dark mode.
- **Motion:** Astryx fast (175ms) / medium (410ms) durations, `cubic-bezier(0.24, 1, 0.4, 1)` standard easing, `cubic-bezier(0.3, 0, 0.6, 0.6)` exit easing.
- **Press feedback:** hover/press overlay fades over 175ms, with instant press-in and a 0.97–0.98 press scale.
- **Entrances:** popover scales/fades in over 175ms; popup list items stagger 30ms; toasts and the options page fade in.
- **Reduced motion:** all animations/transitions collapse when `prefers-reduced-motion: reduce` is set.

Figtree is bundled under the SIL Open Font License — see `fonts/figtree.LICENSE.txt`.

## Project structure

```
CF7-Form-Detector/
├── manifest.json
├── icons/                  # 16/32/48/128 px icons
├── fonts/                  # Figtree woff2 + license
└── src/
    ├── shared/
    │   ├── settings.js     # Default settings + storage helpers
    │   ├── tokens.css      # Astryx-derived design tokens
    │   └── fonts.css       # Figtree @font-face
    ├── content/content.js  # Detection, admin URLs, floating widget, prefill
    ├── popup/              # Popup dashboard
    └── options/            # Options page
```

## Browser support

- Chrome 114+ for the top-layer floating widget (Popover API).
- Older Chromium versions fall back to max z-index.
- Manifest V3.

## Notes

- Forms inside cross-origin iframes are not scanned.
- The CF7 REST title lookup only works when you are logged in with permission to edit forms; otherwise nearby headings or the form ID are used.
- The floating widget never injects on non-WordPress sites.