const GITHUB_RELEASE_BASE =
  "https://github.com/williamsouzadelima/hackerai/releases/latest/download";

export const downloadLinks = {
  macos: `${GITHUB_RELEASE_BASE}/Suricatoos-universal.dmg`,
  windows: `${GITHUB_RELEASE_BASE}/Suricatoos-windows-x64.exe`,
  linuxAppImage: `${GITHUB_RELEASE_BASE}/Suricatoos-linux-x64.AppImage`,
  linuxArm64AppImage: `${GITHUB_RELEASE_BASE}/Suricatoos-linux-arm64.AppImage`,
  linuxDeb: `${GITHUB_RELEASE_BASE}/Suricatoos-linux-x64.deb`,
  linuxArm64Deb: `${GITHUB_RELEASE_BASE}/Suricatoos-linux-arm64.deb`,
};
