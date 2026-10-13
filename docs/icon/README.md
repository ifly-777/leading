# The icon

`concepts.png` shows the three directions considered; B (the Literata L with a
highlighter stroke) was chosen.

The icon lives in `mac/Resources/AppIcon.icon`, Apple's Icon Composer format:
a paper-coloured background fill and two layers (`stroke.png`, `letter.png`),
which macOS 26 lights and tints itself. `scripts/build-app.sh` compiles it
with `actool`. The layers are drawn in `layers.html` and rendered with
`node web/scripts/render-icon.mjs`. The file can also be opened and adjusted in Icon
Composer, which comes with Xcode.
