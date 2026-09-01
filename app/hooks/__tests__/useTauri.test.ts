import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { navigateToAuth, pickLocalFolder } from "../useTauri";

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}));

jest.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: jest.fn(),
}));

jest.mock("@tauri-apps/plugin-dialog", () => ({
  open: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
  },
}));

const mockInvoke = invoke as jest.Mock;
const mockDialogOpen = open as jest.Mock;
const mockOpenUrl = openUrl as jest.Mock;
const mockToastError = toast.error as jest.Mock;
let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

function setTauriEnvironment() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("navigateToAuth", () => {
  beforeEach(() => {
    setTauriEnvironment();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockOpenUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: undefined,
    });
  });

  it("uses in-webview auth without native desktop bridges (signup)", async () => {
    await navigateToAuth("/signup?returnTo=%2Fsettings");

    // Desktop app é webview do web app: navega in-webview (window.location),
    // sem browser externo, deep-link ou prompt de update.
    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("uses in-webview auth without native desktop bridges (login)", async () => {
    await navigateToAuth("/login");

    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});

describe("pickLocalFolder", () => {
  beforeEach(() => {
    setTauriEnvironment();
    mockDialogOpen.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: undefined,
    });
  });

  it("opens a single-directory picker and returns the selected path", async () => {
    mockDialogOpen.mockResolvedValue("/Users/hackerai/targets/acme");

    await expect(pickLocalFolder()).resolves.toBe(
      "/Users/hackerai/targets/acme",
    );
    expect(mockDialogOpen).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
    });
  });

  it("returns null when the user cancels", async () => {
    mockDialogOpen.mockResolvedValue(null);

    await expect(pickLocalFolder()).resolves.toBeNull();
  });
});
