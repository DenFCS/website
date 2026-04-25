# DEN × FCS — Website

Static website for The Den × FCS. Built with plain HTML and CSS, deployable to
GitHub Pages with no build step.

---

## Project Structure

```
den-fcs-site/
├── index.html                    ← Home (TODO)
├── facilities.html               ← The Facilities (TODO)
├── staff.html                    ← The Staff (TODO)
├── programs.html                 ← Programs (TODO)
├── events.html                   ← Events (TODO)
├── locker-room.html              ← The Locker Room (TODO)
├── about.html                    ← About Us (TODO)
│
├── css/
│   ├── tokens.css                ← Brand system: colors, fonts, spacing
│   ├── base.css                  ← Resets + default typography
│   └── components.css            ← Nav, footer, buttons, cards
│
├── fonts/
│   ├── Orbitron-Bold.ttf         ← Headings 700
│   ├── Orbitron-ExtraBold.ttf    ← Headings 800
│   ├── Newsreader-Light.ttf      ← Body 300 (default)
│   ├── Newsreader-Regular.ttf    ← Body 400
│   ├── Newsreader-SemiBold.ttf   ← Body 600
│   ├── GolosText-Variable.ttf    ← UI labels, buttons, nav
│   └── CalSans-Regular.ttf       ← Reserve display font
│
├── images/
│   ├── logo-circle.png           ← Circle lion mark (black text)
│   ├── logo-circle-metallic.png  ← Circle lion mark (silver text)
│   └── logo-horizontal.png       ← Horizontal THE DEN × FCS lockup
│
├── assets/
│   └── DEN-FCS-Style-Guide.pdf   ← Downloadable brand style guide
│
└── README.md
```

---

## Brand Foundation

### Colors

Core palette: **White, Gold, Tan, Brown, Black** — each expanded into a working
scale in `css/tokens.css`. The brand runs primarily dark: `--neutral-50` or
`--neutral-100` backgrounds, white headings, `--gold-400` accents.

Primary brand gold: `#C9A961` (`--gold-400`)
Base tan: `#D4B896` (`--tan-300`)
Base brown: `#5C4328` (`--brown-400`)

### Typography

| Use | Font | Weight |
| --- | --- | --- |
| Headings | Orbitron | 700 / 800 |
| Body copy | Newsreader | 300 / 400 / 600 |
| UI labels, buttons, nav | Golos Text | 500 / 600 |
| Reserve display | Cal Sans | 400 |

### Voice

Direct. Confident. Evidence-based. Specific numbers, real names, precise claims.
No hype, no filler, no stock-phrase marketing copy. Details equal numbers.

See `assets/DEN-FCS-Style-Guide.pdf` for the complete brand system with samples.

---

## How to Edit

### Change a color site-wide
Edit the relevant variable in `css/tokens.css`. Every page updates automatically.

### Change a font
Update the `@font-face` block in `css/tokens.css` and replace the font file in
`fonts/`.

### Change the nav or footer
They're hard-coded on each page (this is a static site with no templating).
Search and replace across all HTML files when changes are needed. Look for the
`<!-- NAV START -->` and `<!-- NAV END -->` comments.

### Add a new page
1. Copy an existing HTML file and rename it.
2. Update the `<title>` and `<h1>`.
3. Add a link to it in the nav on every other page.
4. Make sure it includes all three CSS files in the correct order:
   ```html
   <link rel="stylesheet" href="css/tokens.css">
   <link rel="stylesheet" href="css/base.css">
   <link rel="stylesheet" href="css/components.css">
   ```

---

## How to Deploy

### GitHub Pages (free)
1. Create a new GitHub repository.
2. Upload this entire folder.
3. In repo settings → Pages, set source to `main` branch, root directory.
4. Custom domain: add a `CNAME` file with your domain (e.g. `thedenfcs.com`)
   and configure DNS with your registrar.
5. Enable "Enforce HTTPS" in Pages settings.

### Local preview
No build step required. Open any HTML file directly in a browser, or run a
local server:
```
python3 -m http.server 8000
```
Then visit `http://localhost:8000`.

---

## Open TODOs

- [ ] Build `index.html` (Home)
- [ ] Build `facilities.html`
- [ ] Build `staff.html`
- [ ] Build `programs.html`
- [ ] Build `events.html`
- [ ] Build `locker-room.html`
- [ ] Build `about.html`
- [ ] Add real athlete photos for hero sections
- [ ] Add staff headshots
- [ ] Add facility photos for each location
- [ ] Wire up enrollment/payment flow (Stripe? external?)
- [ ] Set up domain + DNS
- [ ] Add favicon
- [ ] Add Open Graph meta tags (for link previews on social)
- [ ] Set up analytics (optional)
