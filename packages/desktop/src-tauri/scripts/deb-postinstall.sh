#!/bin/sh
# Register suricatoos:// protocol handler after deb install
if command -v update-desktop-database > /dev/null 2>&1; then
    update-desktop-database /usr/share/applications || echo "warn: update-desktop-database failed" >&2
fi
if command -v xdg-mime > /dev/null 2>&1; then
    xdg-mime default com.suricatoos.desktop.desktop x-scheme-handler/suricatoos || echo "warn: xdg-mime default failed" >&2
fi
