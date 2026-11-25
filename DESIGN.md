# Doctor Barmods: Clinical Clean Ops Design Brief

## Design Read

Reading this as: VPN provisioning operational console for Indonesian tunnel operators and users, in a Clinical Clean Ops instrument-panel visual language, dial ENERGY 2 / RHYTHM 3 / MOTION 2.

All three dials stay fixed at `ENERGY 2 / RHYTHM 3 / MOTION 2` across the document. Rather than opening with a decorative marketing hero, the page drops straight into the working provisioning console where crisp 1px borders (`#CBD8D4` light, `#253A36` dark) and surgical teal state controls (`#0B6E5C` light, `#2DD4B4` dark) show which tier and protocol are armed. Section layouts shift shape intentionally from top to bottom.

## Nine-Field Design Brief

### product
Doctor Barmods is a web console for creating tunnel accounts on port-5888 VPN nodes, built as a single root `index.html` paired with one zero-dependency Vercel Serverless Function (`api/vpn.js`) covering `SSH`, `VMess`, `VLESS`, `Trojan`, and `Shadowsocks`.

### industry
Encrypted tunnel operations and small reseller infrastructure. Most VPN panels copy neon hacker templates; we went the opposite way and treated account provisioning like a clean diagnostic chart where ports, UUIDs, and quotas read clearly in broad daylight.

### audience
Indonesian tunnel operators, community node admins, and mobile users. Many trial users open this console on a 375px Android screen before pasting links into HTTP Custom, v2rayNG, or NekoBox, while admins often issue paid accounts at night from 1440px laptop screens or configure OpenWrt routers (`PassWall2` and `OpenClash`).

### primary_objective
Public visitors can test a 1-day trial under per-IP rate limits on the exact same URL where node admins enter a server-verified PIN to issue custom accounts, while backend `auth` secrets never leave the server.

### user_outcome
After selecting a node, choosing one of the five protocols, and submitting an alphanumeric username, the user immediately receives individual copy buttons for TLS, HTTP WS, gRPC, and HTTP Custom URIs alongside a plain-text `.txt` download. Everything happens on one screen without page reloads.

### information_architecture
1. Sticky instrument header (`<header>` and `<nav>`) with `barmods-rx-mark.svg`, the `DOCTOR BARMODS` wordmark, a live node counter fed by `GET /api/vpn`, three real anchor links (`#workbench`, `#arsitektur-port`, `#panduan-klien`), and the Light/Dark switch.
2. Section 1 (`#workbench`): 12-column split console placing a 7-column Control Deck on the left and a sticky 5-column Live Credential and Telemetry Output Sheet (`aria-live="polite"`) on the right.
3. Section 2 (`#arsitektur-port`): 2-column technical reference pairing the port/path matrix table on the left with a live WebSocket Bug Host `[crlf]` payload builder on the right.
4. Section 3 (`#panduan-klien`): 2-column reference pairing native `<details>/<summary>` client guides with a copyable `VPN_SERVERS_JSON` Vercel setup snippet.
5. Footer (`<footer>`): Direct privacy note, section jump links, and the `Build by konoha` signature.

### interactions
Every control changes real state. Switching between `Trial Publik` and `Create Premium` swaps fixed public limits (`1 Hari`, `2 IP`, `5 GB`) for operator inputs (`1..365` days, custom GB quota where `0` means Unlimited, `1..100` IP limit, and `PIN Admin`) while updating the submit button label to name the exact protocol and tier. SSH mode reveals password generation via `crypto.getRandomValues`, and empty output mode offers a `Lihat Contoh Format Output` preview clearly badged `[CONTOH PRATINJAU]`.

### visual_identity
Light mode (`data-theme="light"`, default) pairs `#F4F7F6` canvas and `#FFFFFF` cards with `#0B6E5C` primary buttons (`#FFFFFF` text), whereas dark mode (`data-theme="dark"`) switches to `#0B1211` canvas and `#121D1B` surfaces with `#2DD4B4` primary buttons (`#06231D` text). Diagnostic crimson (`#B4232C` / `#F87171`) appears only on errors.

### technical_constraints
Zero runtime npm dependencies. Client markup, CSS tokens, inline SVGs, and state live in `index.html`, while `api/vpn.js` handles `GET` and `POST` using Node native `fetch` (`AbortSignal.timeout(15000)`) and `node:crypto` (`timingSafeEqual`), enforcing `/^[a-zA-Z0-9]+$/` usernames, `>= 44px` tap targets, and zero emojis or em/en-dashes.

## Written Reasons for Visual and UX Decisions (R-31)

| Decision Area | One-Line Reason |
|---|---|
| **Palette** | Surgical teal (`#0B6E5C` / `#2DD4B4`) and crimson (`#B4232C` / `#F87171`) separate normal actions from errors at `>= 6.18:1` contrast. |
| **Layout** | A 7/5 split keeps inputs and generated credentials visible together on desktop. |
| **Typography** | `Plus Jakarta Sans` keeps Indonesian form labels legible at small sizes, while `JetBrains Mono` prevents `0`/`O` and `1`/`l`/`I` mix-ups inside UUIDs, passwords, ports, and `[crlf]` strings. |
| **Spacing** | Tight `8px` control gaps fit the form above the fold; `48px` section breaks separate reference tools. |
| **Icons** | Hand-drawn 20px SVGs show each protocol's real structure instead of generic stock library icons. |
| **Motion** | Transitions run at `180ms` for crisp feedback and stop completely when `prefers-reduced-motion: reduce` is active. |

## Responsive Reflow Plan (375px / 768px / 1440px)

No horizontal scroll at any width. On `375px` phones, the header stacks above a 3-button touch bar, protocol buttons wrap into two columns, and long URIs break cleanly inside `min-width: 0` containers; on `768px` tablets, navigation aligns in one row and numeric fields form a 2x2 grid. Full `1440px` desktop viewports unlock the 7/5 asymmetric console and 6/6 reference panels.

## Verified WCAG 2.x Contrast Ratios

| Theme | Foreground | Background | Ratio | Minimum | Status |
|---|---|---|---|---|---|
| Light | `#0F1F1C` (`--text-primary`) | `#FFFFFF` (`--bg-surface`) | 17.05:1 | 4.5:1 | PASS |
| Light | `#0F1F1C` (`--text-primary`) | `#F4F7F6` (`--bg-canvas`) | 15.81:1 | 4.5:1 | PASS |
| Light | `#3B524D` (`--text-secondary`) | `#FFFFFF` (`--bg-surface`) | 8.40:1 | 4.5:1 | PASS |
| Light | `#3B524D` (`--text-secondary`) | `#E8EFEC` (`--bg-subtle`) | 7.20:1 | 4.5:1 | PASS |
| Light | `#FFFFFF` (`--btn-primary-text`) | `#0B6E5C` (`--accent-primary`) | 6.18:1 | 4.5:1 | PASS |
| Light | `#B4232C` (`--accent-crimson`) | `#FFFFFF` (`--bg-surface`) | 6.53:1 | 4.5:1 | PASS |
| Dark | `#ECF4F2` (`--text-primary`) | `#121D1B` (`--bg-surface`) | 15.45:1 | 4.5:1 | PASS |
| Dark | `#ECF4F2` (`--text-primary`) | `#0B1211` (`--bg-canvas`) | 16.96:1 | 4.5:1 | PASS |
| Dark | `#9BB3AD` (`--text-secondary`) | `#121D1B` (`--bg-surface`) | 7.77:1 | 4.5:1 | PASS |
| Dark | `#9BB3AD` (`--text-secondary`) | `#192825` (`--bg-subtle`) | 6.88:1 | 4.5:1 | PASS |
| Dark | `#06231D` (`--btn-primary-text`) | `#2DD4B4` (`--accent-primary`) | 8.84:1 | 4.5:1 | PASS |
| Dark | `#F87171` (`--accent-crimson`) | `#121D1B` (`--bg-surface`) | 6.24:1 | 4.5:1 | PASS |
