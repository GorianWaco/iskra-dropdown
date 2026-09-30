#!/usr/bin/env bash
# Iskra drop-down — rozszerzenie GNOME Shell.
# Kładzie pliki w katalogu rozszerzeń użytkownika i włącza uuid.
set -euo pipefail

UUID="iskra-dropdown@gorian"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

mkdir -p "$DEST/icons" "$DEST/schemas"
install -m 644 \
  "$SRC/extension.js" \
  "$SRC/manager.js" \
  "$SRC/metadata.json" \
  "$SRC/panelicon.js" \
  "$SRC/prefs.js" \
  "$SRC/stylesheet.css" \
  "$DEST/"
install -m 644 "$SRC/icons/iskra.svg" "$SRC/icons/iskra.png" "$DEST/icons/"
install -m 644 "$SRC/schemas/org.gnome.shell.extensions.iskra-dropdown.gschema.xml" "$DEST/schemas/"
if [[ -f "$SRC/schemas/gschemas.compiled" ]]; then
  install -m 644 "$SRC/schemas/gschemas.compiled" "$DEST/schemas/"
fi
if command -v glib-compile-schemas >/dev/null 2>&1; then
  glib-compile-schemas "$DEST/schemas"
fi

echo "Rozszerzenie jest w ${DEST}"
if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable "$UUID" || echo "Włączy się po wylogowaniu."
fi
echo "Nowe rozszerzenie GNOME ładuje się po wylogowaniu i zalogowaniu."
