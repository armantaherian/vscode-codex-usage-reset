import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { accessibleLabel, formatStatus, severity, tooltipMarkdown } from "./format";
import { readSessionSnapshot } from "./sessionContext";
import type { ContextSnapshot, StatusInput, UsageHistory, UsageSnapshot } from "./types";
import { loadLiveUsage } from "./usageApi";
import { readUsageHistory } from "./usageHistory";
import type { TileTheme } from "./tiles";

let statusItem: vscode.StatusBarItem | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let displayTimer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;
let usage: UsageSnapshot | undefined;
let contextSnap: ContextSnapshot | undefined;
let history: UsageHistory | undefined;
let problem: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.name = "Codex Usage";
  statusItem.command = "codexUsage.refresh";
  statusItem.text = "$(sync~spin) Codex";
  statusItem.tooltip = "Loading Codex usage…";
  statusItem.show();

  context.subscriptions.push(statusItem);
  context.subscriptions.push(vscode.commands.registerCommand("codexUsage.refresh", () => refresh(true)));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("codexUsage")) {
      schedule();
      void refresh(false);
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void refresh(false);
  }));
  context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => render()));
  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
      if (displayTimer) {
        clearInterval(displayTimer);
      }
    },
  });

  schedule();
  await refresh(false);
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  if (displayTimer) {
    clearInterval(displayTimer);
  }
}

function schedule(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  if (displayTimer) {
    clearInterval(displayTimer);
  }
  const seconds = vscode.workspace.getConfiguration("codexUsage").get<number>("refreshSeconds", 60);
  const period = Math.max(15, seconds) * 1000;
  refreshTimer = setInterval(() => {
    void refresh(false);
  }, period);
  displayTimer = setInterval(() => render(), 15_000);
}

async function refresh(manual: boolean): Promise<void> {
  if (refreshing) {
    return;
  }
  refreshing = true;
  const home = codexHome();
  let liveError: string | undefined;
  let live: UsageSnapshot | undefined;
  try {
    live = await loadLiveUsage(home);
  } catch (error) {
    liveError = errorMessage(error);
  }

  let sessionContext: ContextSnapshot | undefined;
  let sessionUsage: UsageSnapshot | undefined;
  try {
    const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const session = await readSessionSnapshot(home, folders);
    sessionContext = session?.context;
    sessionUsage = session?.usage;
  } catch (error) {
    liveError = liveError ?? errorMessage(error);
  }

  try {
    history = await readUsageHistory(home);
  } catch {
    history = undefined;
  }

  usage = live ?? sessionUsage;
  contextSnap = sessionContext;
  if (live) {
    problem = undefined;
  } else if (sessionUsage) {
    problem = liveError ?? "Showing the latest Codex session snapshot.";
  } else {
    problem = liveError ?? "Codex usage is not available yet.";
  }

  refreshing = false;
  render();
  if (manual && !usage && problem) {
    void vscode.window.showWarningMessage(problem);
  }
}

function render(): void {
  if (!statusItem) {
    return;
  }
  const input: StatusInput = { usage, context: contextSnap, history, theme: colorTheme(), now: Date.now(), problem };
  const text = formatStatus(input);
  statusItem.text = text;
  statusItem.accessibilityInformation = { label: accessibleLabel(text), role: "button" };
  const markdown = new vscode.MarkdownString(tooltipMarkdown(input));
  markdown.isTrusted = false;
  markdown.supportThemeIcons = false;
  statusItem.tooltip = markdown;
  const level = severity(input);
  statusItem.backgroundColor = level === "error"
    ? new vscode.ThemeColor("statusBarItem.errorBackground")
    : level === "warning"
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
  statusItem.show();
}

function colorTheme(): TileTheme {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";
}

function codexHome(): string {
  const configured = vscode.workspace.getConfiguration("codexUsage").get<string>("codexHome", "").trim();
  if (configured) {
    return configured.replace(/^~(?=$|\/)/, os.homedir());
  }
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
