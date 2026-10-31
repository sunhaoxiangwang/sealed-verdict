# Sealed Verdict — visual direction: "The Coroner's Inquest, after dark"

The 2D interface is the paperwork of a Victorian coroner's inquest held by candlelight. Every fact is an **evidence tag**: manila card, brass eyelet, typewritten label, ink stamp. Every judgment is **a stamped docket**. The verdict is **a sealed writ**. The 3D courtroom (already built, do not restyle) supplies the candlelight; the UI supplies the paperwork. Halloween lives in the morbidity of an inquest, blackletter headers, wax, and candle glow, never in pumpkins, cobwebs or bats.

## Ground and light
- Ground is rocked velvet black `#0b0a0d`; panels are plate-tone brown-black `#15110f` where light falls, never flat grey.
- Light is warm and local: candle orange `#ff8c3a` appears only as glow (text-shadow, box-shadow, active-phase lamp), never as a fill or button colour.
- Paper: manila tag `#d9c48f`, parchment `#e8dcc0`, aged edge `#b89f62`. Paper surfaces get a faint grain (inline SVG feTurbulence at 4–6% opacity) and a 1px darker bottom-right edge shadow, not drop shadows.
- Ink: india-ink black `#15110f` on paper; stamps are wax red `#9b1b1b` (FORGED, VOID, TAINTED, SPECIMEN) and spectral green `#3f9a5f` on paper / `#5ac47c` on dark (VERIFIED, ATTESTED, HELD); uncertain is amber `#d7a73b`.
- Hardware: brass `#c9a24a` with dark brass `#8a6a2a` for eyelets, pins, rails, toggle, button rims. Metallic look = two-stop linear gradient + 1px highlight, never a glossy blob.

## Type (self-hosted, see src/styles/fonts.css)
- Wordmark and section kickers: **Pirata One** (blackletter), used small and sparingly: wordmark, page kickers ("INQUEST No. 0412"), stamp text never.
- Headings and body: **Libre Caslon Text** 400 / 400 italic / 700. Headings tracked slightly tight, body 16–17px, line-height 1.5.
- Typewritten labels on tags and forms: **Special Elite** 12–13px, uppercase, letter-spacing 0.08em, ink slightly uneven (opacity .92).
- Hashes, ids, numbers: **JetBrains Mono** (already in public/fonts).
- Scale: 11 / 13 / 15 / 17 / 22 / 30 / 44. More space above a heading than below it.

## Components
- **Top bar: the docket header.** Wordmark "Sealed Verdict" in Pirata One with a 14px inked wax-seal glyph (inline SVG) before it; under it, on the courtroom page only, the typewritten line "Debate gives you agreement. Signatures give you accountability." Nav links are folder tabs: manila tab shape (clip-path), typewriter caps, the active tab lifted and lighter; phase pill at right becomes a small docket stamp box.
- **Phase ribbon: the inquest docket.** A carbon-copy form strip with five ruled boxes, labels typewritten (ATTEST, COMMIT, REVEAL, DELIBERATE, VERDICT). Completed boxes carry a green ink stamp "DONE" rotated -6°; the active box receives a red stamp with the press animation and a candle-orange underline glow; upcoming boxes are empty ruled boxes.
- **Transcript feed: evidence tags.** Each item is a manila tag (rounded-rect with a cut corner at top-left and a brass eyelet with a short string drawn in CSS), typewritten header line: `EXHIBIT e3 · ORACLE` or `JUROR shade-b24 · ROUND 2`, then the body in Libre Caslon. Signature badge is a circular ink stamp overlapping the tag's right edge: VERIFIED (green ring, rotated -8°), FORGED and UNATTESTED (red, "VOID" style with a strike line). System and phase items are narrower slips of white carbon paper with a typewritten line, no eyelet. New items swing in (rotate -3° → 0, 280ms ease-out).
- **Buttons: brass plates.** Dark ground, 1px brass rim, label in Special Elite caps with a letterpress text-shadow (0 1px 0 rgba(0,0,0,.6)); hover: inner glow candle-orange at 25%; active: translateY(1px). The three attack buttons are **writs**: parchment chips with a small red wax seal at the left and a red rim; their labels "Forge evidence", "Turn juror Byzantine", "Tamper transcript". MOCK/LIVE is a brass toggle switch with a tiny lantern that lights when LIVE.
- **Cards (results, replay, certificate):** report forms: paper panel with a ruled top band (typewritten title on the band), thin brass corner pins, no rounded 10px radius; radius 3px max. Charts keep their data colours; chart text in JetBrains Mono.
- **Stamps:** `.stamp` utility: uppercase Special Elite, 2px double border, rotated -6° to -10°, mix-blend-mode multiply on paper, slight ink bleed via text-shadow 0 0 1px currentColor; the press animation is scale(1.25)→1 with 180ms cubic-bezier(.2,.9,.3,1.2), once, on mount.

## Pages
- **Courtroom:** unchanged layout; docket ribbon on top, evidence tags on the right, writs and brass buttons below. The 3D panel keeps its height rule and gets a 1px brass rim with a darker inset shadow like a framed window.
- **Results = "The Coroner's Findings."** Kicker in Pirata One, title in Caslon. Stat tiles are three typewritten ledger lines on one form, not three cards. The ILLUSTRATIVE pill becomes a red "SPECIMEN — NOT MEASURED" stamp across the top-right of the ladder form; MEASURED becomes a green "ENTERED INTO RECORD" stamp.
- **Replay = "Two inquests, one body of evidence."** Two forms side by side pinned with brass pins; the C2 form's verdict gets a red "TAINTED BY HERDING" stamp, C5's a green "HELD". Juror chips are small tags; FLIPPED is a red typewritten note "recanted".
- **Certificate = the sealed writ.** Parchment with two fold creases (subtle gradients), a red ribbon down the left edge, the wax seal badge at top-right (keep the crack-on-tamper), the checklist as a ledger with ruled lines and PASS/FAIL ink stamps; the raw JSON in a "clerk's copy" details element in typewriter.

## Motion and accessibility
- Only three motions: stamp press, tag swing-in, candle flicker on orange glows (3s, subtle). All disabled under prefers-reduced-motion.
- Body text contrast ≥ 4.5:1 on both paper and velvet; stamps may be decorative but their text must still read.
- Phone width: 16px gutters, tags full-width, tabs scroll horizontally, no horizontal page scroll.

## Never
- No pumpkins, bats, cobwebs, dripping-blood fonts, neon glows, glassmorphism, or orange fills. No generic card grid with 10px radii. No new runtime dependencies.
