# Icons

Five candidate marks for viburnum. All 64×64 at 1×, transparent, flat pixel art. Each PNG sits
beside a `.pixelart.json` sidecar, so any of them can be reopened with `pixelart_draw` (`from`) and
nudged without redrawing.

| File | Mark | Colours | Read |
| :--- | :--- | :--- | :--- |
| `blue-butterfly.png` | Faceless butterfly after a Morpho dorsal view: indigo body, forewings overlapping the hindwings at a dark seam, copper-ringed ocelli, lavender highlights, head glint, 7° tilt | 12 | The elegant one; reads at 16 px. The source; the shipped mark is its trimmed crop below. |
| `blue-butterfly-dark.png` | The same mark with the body in the head's dark slate instead of indigo, and a faint violet rim light on the head | 11 | Head and body read as one piece; quieter, closer to a specimen. The alternative. |
| `blue-butterfly-mark.png` | The 52×46 transparent-margin-trimmed crop of `blue-butterfly.png` | 12 | The package icon and the sidebar glyph; no empty edge, so it reads larger. |
| `amber-butterfly.png` | Monarch, rounded wings, black body, cream dashes in the tips | 4 | Reads at 20 px; warm counterpoint to the blue. |
| `viburnum-sprig.png` | Diagonal branch, two three-lobed leaves, three drupes, six florets | 11 | Best at 64; the florets disappear small. |
| `viburnum-umbel.png` | Emblem: seven florets over three drupes | 8 | Legible, but the stem reads as a trident and the florets sit apart. |
| `viburnum-butterfly.png` | Butterfly above an umbel | ~10 | The idea is right, the execution is two objects rather than one. |

The three butterfly marks share one palette family (`#141a2e`/`#1b3763`/`#2c6499`/`#4a8fc4`/`#7c7fc6`
with `#b3a6ef` lavender, `#4a4a8c` indigo body, `#b5652f`/`#e8a05c` copper for the blue one,
`#1a120c`/`#c95a1e`/`#e8944a`/`#f4e3c2` for the amber). The flower marks use `#23201a` outline,
`#f6f2e4`/`#d9d2bd` petals, `#d8a13f` centres, `#b8322a`/`#e0554a`/`#7d1f1a` drupes and
`#3f5a32`/`#6f8f4d` leaves.

The package icon is `blue-butterfly-mark.png`: the original 64×64 canvas had 8/4/3/15 px of empty
edge around the mark, so the shipped crop is the 52×46 mark itself (declared through `package.json`
`icon` and exported as `./icon`). The **sidebar glyph** embeds the same PNG as a data URI and draws
it larger than the row cell; the status dot sits after it, before the label. The final shipped mark
may still change: candidates stay in this directory until one has survived the sidebar at its real
size.

The blue butterfly's wing arrangement follows a *Morpho menelaus* dorsal specimen — forewing over
hindwing, dark seam, hindwing about half the wing area — from the MHNT collection on
[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Morpho_menelaus_huebneri_MHNT_Male_Dos.jpg).

## Where these are used

Checked against the harness UI rather than guessed: a bundle icon renders in a 48×48 card
(`.cardIcon`), in 40×40 detail rows (`.rowIcon`), and as a preview capped at 320 px height
(`.packagePreview`). There is no 16 px surface, so a single 64×64 master covers every case — the
browser scales it down for the card and leaves it near 1:1 in the preview.
