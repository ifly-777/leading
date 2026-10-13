# Layout of the disk image's window, read by dmgbuild (scripts/make-dmg.sh).
# Positions are icon centres in points and must match the gaps left in
# mac/Resources/dmg/background.html (600 × 470).
import os

app = defines["app"]            # path to Leading.app
guide = defines["guide"]        # path to "If macOS blocks Leading.pdf"
background = defines["background"]

files = [app, guide]
symlinks = {"Applications": "/Applications"}

format = "UDZO"                 # compressed, read-only
filesystem = "APFS"
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
# The window is 28 pt taller than the background: Finder counts its title bar.
window_rect = ((200, 160), (600, 498))
icon_size = 96
text_size = 13
icon_locations = {
    os.path.basename(app): (150, 160),
    "Applications": (450, 160),
    os.path.basename(guide): (300, 366),
}
