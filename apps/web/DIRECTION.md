# Sealed Verdict — visual direction v2: "Night court, modern"

Replace the paper-and-stamps look entirely. The new UI is a premium, modern dark product interface (think a 2026 AI product: Linear, Vercel, Arc levels of polish) with one Halloween signature: ember light in a black void. The 3D courtroom is the hero; the UI is a quiet, glassy HUD around it. No paper, no stamps, no typewriter, no blackletter, no cobwebs, no pumpkins.

## Ground, surfaces, light
- Page ground: `#07060a` with one large, very soft radial glow of ember `rgba(255,140,58,.10)` top-center and a violet glow `rgba(120,80,255,.08)` bottom-right. Fixed, not scrolling.
- Surfaces are glass: `background: rgba(255,255,255,.035)`, `border: 1px solid rgba(255,255,255,.08)`, `backdrop-filter: blur(16px)`, radius 14px (cards) / 10px (inputs, chips) / 999px (pills). Elevated surfaces add a 1px top highlight `rgba(255,255,255,.12)` via inset box-shadow. No drop shadows except a single soft ambient shadow on floating panels `0 20px 60px rgba(0,0,0,.45)`.
- Text: `#f3efe8` primary, `#a9a3b3` secondary, `#6f6a7a` tertiary. Never pure white.
- Accents (only for meaning): ember `#ff8c3a` = live/active/attention; verified green `#4ade80`; forged red `#f87171`; uncertain amber `#fbbf24`; brass `#d6b36a` only for the wordmark seal and the certificate ribbon. Accent colours appear as 1px borders, dots, text, and soft outer glows (`0 0 24px color at 35%`), never as large fills. Buttons are neutral glass; the primary action is a white-on-dark pill.
- Signature: ember light. The active phase, a speaking juror, the live toggle, and the verdict moment glow ember with a slow 3s breathing animation (reduced-motion: static).

## Type (self-hosted in src/styles/fonts.css)
- Display: **Redaction** (OFL, redaction.us), a serif drawn from court documents whose numbered cuts are progressively degraded, like re-photocopied filings. It replaces Instrument Serif, which the user rejected as generic "AI slop".
  - Page titles, section headings, composer title: `var(--font-display)` = Redaction 35, weight 400, 30–44px, letter-spacing -0.005em.
  - Wordmark: `var(--font-wordmark)` = Redaction 20 (cleaner at small sizes), 21px, "Sealed" regular + "Verdict" italic.
  - The verdict word (TRUE / FALSE / UNCERTAIN) and the certificate title: `var(--font-stamp)` = Redaction 50 Bold, uppercase, letter-spacing 0.02em, so the ink texture reads like a court stamp.
  - Never hardcode a display family; always use these tokens. Never use Instrument Serif, Fraunces, Playfair, Cormorant or similar defaults.
- UI: **Inter** 400 / 500 / 600 with `font-feature-settings: "cv11", "ss01", "tnum"`; body 15px / 1.5; labels 12px uppercase tracking .08em in 500.
- Data (hashes, ids, numbers): **JetBrains Mono** 400, 12–13px, `#a9a3b3`, tnum.

## Layout and components
- **Top bar**: 56px, transparent over the glow, bottom border `rgba(255,255,255,.06)`. Left: the Logo component (envelope-and-wax-seal mark + "Sealed Verdict" wordmark in var(--font-wordmark), "Verdict" italic). Centre: nav as a segmented pill (glass track, the active item a lighter glass pill with 1px border, 13px Inter 500). Right: a status chip: ember dot + "DELIBERATE" in 12px caps when a case runs, grey dot + "IDLE" otherwise.
- **Phase progress** (courtroom): a slim 6px track with five segments and small labels beneath (12px caps). Completed segments green at 60%, active ember with glow and a sliding shimmer, upcoming `rgba(255,255,255,.08)`. No boxes.
- **3D panel**: full-bleed within its glass frame, radius 16px, 1px border, and an inner vignette overlay (CSS gradient) so the edges melt into the page. A small floating HUD chip at top-left of the panel: case id in mono + claim in 13px, max 2 lines, glass pill.
- **Transcript** ("Ledger"): a vertical stream. Each item: a 28px avatar disc (initials of the pseudonym in mono, disc tinted by juror: give each pseudonym a hue from a fixed list of 4 muted hues), a header line (pseudonym 13px 500, then "· REVEAL" 12px caps tertiary, then a status pill at right: `verified` green outline pill, `forged` / `unattested` red outline pill, 11px caps), then the body 14px secondary→primary on hover. Evidence items use a document icon instead of an avatar and show the source in mono. System and phase items are single centred lines, 12px tertiary, with a thin divider. New items fade+rise in (6px, 220ms ease-out). The list is `scroll-behaviour: smooth` and auto-scrolls to bottom.
- **Controls bar**: left group: Play/Pause primary white pill (icon + label), Replay ghost, speed as a 3-option segmented pill. Middle: the three attack actions as ghost buttons with a small icon and red text on hover, labelled "Forge evidence", "Byzantine juror", "Tamper transcript". Right: MOCK/LIVE as a proper switch (track 36×20, knob, ember when LIVE) with a 12px label.
- **Results**: page title "Bias ablation ladder" in var(--font-display), a one-sentence lede, then three stat tiles in one glass row (label 12px caps, value 32px var(--font-display), delta/note 13px). Charts live in glass cards with a 12px caps title and a right-aligned legend; keep the data colours; axes `rgba(255,255,255,.06)`. The ILLUSTRATIVE state is a small amber outline pill "Illustrative data" next to the title, MEASURED a green pill "Measured · n=…". Table rows 13px with mono numbers.
- **Replay**: two glass columns with a sticky header per column (condition name 16px 500, description 13px secondary), juror chips as avatar disc + name + vote pill; "flipped" shows as a small red pill "flipped". Verdict banner at the bottom of each column: a glass bar with a coloured left border (red for herded, green for held) and the text.
- **Certificate**: a document card on glass with a subtle brass left border (3px gradient), title "Verdict certificate" in var(--font-stamp), meta as a 2-column definition grid (labels 12px caps, values 14px / mono for hashes with copy-on-click), evidence rows with status pills, voter rows with truncated mono sigs, and the seal badge at top-right as a 64px disc with a conic brass gradient ring, dark centre, "SV" in Redaction 35 Bold; on tamper the ring turns red and gets a thin crack line (SVG). Verify results as a checklist: each row a glass line with a 20px check icon (green) or an X (red) and a short reason; the final banner is a full-width pill "Seal intact" (green outline) or "Seal broken" (red outline).
- **Buttons** everywhere: 36px tall, 13px Inter 500, radius 999px; primary = `#f3efe8` bg / dark text; ghost = glass; danger = ghost with red text and border on hover. Focus ring 2px ember at 60%. Hover transitions 150ms.

## Motion
- Phase change: track segment fills with a 400ms ease; status chip dot pulses once.
- Speaking juror in the ledger: avatar disc gets an ember ring.
- Everything respects prefers-reduced-motion.

## Never
Paper textures, stamps, tags, eyelets, folder tabs, typewriter type, blackletter, bevelled brass plates, orange fills, drop shadows on every card, 90s skeuomorphism of any kind.
