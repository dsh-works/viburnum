# Icons

Five candidates for Viburnum. All 64×64 at 1×, transparent, flat pixel art. Each PNG sits beside a
`.pixelart.json` sidecar, so any of them can be reopened with `pixelart_draw` (`from`) and nudged
without redrawing.

| File | Mark | Colours | Read |
| :--- | :--- | :--- | :--- |
| `blue-butterfly.png` | Spread-wing butterfly, top-down, pale wing-tip spots | 5 | Strong silhouette; the safest mark. |
| `amber-butterfly.png` | Monarch, rounded wings, black body, cream dashes in the tips | 4 | Reads at 20 px; warm counterpoint to the blue. |
| `viburnum-sprig.png` | Diagonal branch, two three-lobed leaves, three drupes, six florets | 11 | Best at 64; the florets disappear small. |
| `viburnum-umbel.png` | Emblem: seven florets over three drupes | 8 | Legible, but the stem reads as a trident and the florets sit apart. |
| `viburnum-butterfly.png` | Butterfly above an umbel | ~10 | The idea is right, the execution is two objects rather than one. |

The three butterfly marks share one palette family (`#0f1b2d`/`#1e4f8f`/`#3f86c9`/`#8fd0ef` for the
blue, `#1a120c`/`#c95a1e`/`#e8944a`/`#f4e3c2` for the amber). The flower marks use
`#23201a` outline, `#f6f2e4`/`#d9d2bd` petals, `#d8a13f` centres, `#b8322a`/`#e0554a`/`#7d1f1a` drupes
and `#3f5a32`/`#6f8f4d` leaves.

Nothing here is wired into a package yet: there is no `package.json` or `icon` field until v0 starts.
The eventual icon is whichever of these survives being shrunk to a sidebar entry.
