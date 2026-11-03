import type { StatusInput, UsageWindow } from "./types";
import { formatUsageCharts } from "./tiles";

const WARNING_AT = 75;
const ERROR_AT = 90;

export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "now";
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) {
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m`;
  }
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
}

export function severity(input: StatusInput): "ok" | "warning" | "error" {
  const usage = input.usage;
  if (!usage) {
    return input.problem ? "warning" : "ok";
  }
  if (usage.limitReached) {
    return "error";
  }
  const used = Math.max(usage.fiveHour?.usedPercent ?? 0, usage.weekly?.usedPercent ?? 0, ...usage.extra.map((window) => window.usedPercent));
  if (used >= ERROR_AT) {
    return "error";
  }
  if (used >= WARNING_AT) {
    return "warning";
  }
  return "ok";
}

export function formatStatus(input: StatusInput): string {
  const parts: string[] = [];
  if (input.usage?.fiveHour) {
    parts.push(windowPart(input.usage.fiveHour, input.now));
  }
  if (input.usage?.weekly) {
    parts.push(windowPart(input.usage.weekly, input.now));
  }
  for (const extra of input.usage?.extra ?? []) {
    parts.push(windowPart(extra, input.now));
  }
  if (input.context) {
    parts.push(`Ctx ${input.context.remainingPercent}%`);
  }
  if (input.usage && input.usage.bankedResets !== null) {
    parts.push(`↺ ${input.usage.bankedResets}`);
  }

  if (!input.usage && !input.context && !input.problem) {
    return "$(sync~spin) Codex";
  }

  const body = parts.length ? `Codex ${parts.join(" · ")}` : "Codex usage";
  if (input.problem && input.usage?.source !== "api") {
    return `$(warning) ${body}`;
  }
  return parts.length ? body : "$(sync~spin) Codex";
}

export function accessibleLabel(text: string): string {
  return text.replace(/\$\([^)]+\)\s*/g, "");
}

export function tooltipMarkdown(input: StatusInput): string {
  const lines: string[] = [];
  const plan = titlePlan(input.usage?.planType ?? null);
  lines.push(plan ? `**Codex** · ${escapeMd(plan)}` : "**Codex**");

  if (input.usage?.limitReached) {
    lines.push("");
    lines.push("**Limit reached.**");
  }
  if (input.problem && input.usage?.source !== "api") {
    lines.push("");
    lines.push(escapeMd(input.problem));
  }
  if (input.usage) {
    lines.push("");
    const when = formatWhen(input.usage.fetchedAtMs);
    lines.push(input.usage.source === "api" ? `Live · ${when}` : `Session snapshot · ${when}`);
    const windows = [input.usage.fiveHour, input.usage.weekly, ...input.usage.extra].filter((window): window is UsageWindow => !!window);
    if (windows.length) {
      lines.push("");
      lines.push("| Window | Used | Left | Resets in |");
      lines.push("| --- | --- | --- | --- |");
      for (const window of windows) {
        const left = `${Math.max(0, 100 - window.usedPercent)}%`;
        const resets = window.resetAtMs === null ? "—" : `${formatRemaining(window.resetAtMs - input.now)} · ${formatWhen(window.resetAtMs)}`;
        lines.push(`| ${escapeMd(window.statusLabel)} | ${window.usedPercent}% | ${left} | ${resets} |`);
      }
    }
  }

  if (input.context) {
    const leftTokens = Math.max(0, input.context.windowTokens - input.context.usedTokens);
    lines.push("");
    lines.push(`**Context remaining:** ${input.context.remainingPercent}% (${leftTokens.toLocaleString()} / ${input.context.windowTokens.toLocaleString()} tokens)`);
    if (input.context.cwd) {
      lines.push(`Session: ${inlineCode(input.context.cwd)}`);
    }
    if (!input.context.matchedWorkspace) {
      lines.push("This is the latest Codex session, and it is outside the open workspace.");
    }
    if (input.context.atMs) {
      lines.push(`Context sampled ${formatWhen(input.context.atMs)}.`);
    }
  }

  if (input.usage && input.usage.bankedResets !== null) {
    lines.push("");
    lines.push(`**Banked resets available:** ${input.usage.bankedResets}`);
    if (input.usage.applicableResets !== null) {
      lines.push(`Applicable to a full window now: ${input.usage.applicableResets}`);
    }
    if (input.usage.resetExpiriesMs.length) {
      lines.push(`Next expiry: ${formatWhen(input.usage.resetExpiriesMs[0])}`);
    }
    lines.push("Showing the count only. This extension does not redeem a reset.");
  }

  if (input.usage?.creditsBalance) {
    lines.push("");
    lines.push(`Credits: ${escapeMd(input.usage.creditsBalance)}`);
  }

  if (input.history && input.history.totalTokens > 0) {
    lines.push("");
    lines.push(formatUsageCharts(input.history, input.theme ?? "dark"));
  }

  lines.push("");
  lines.push("Click the status bar item to refresh.");
  return lines.join("\n");
}

function windowPart(window: UsageWindow, now: number): string {
  if (window.resetAtMs === null) {
    return `${window.label} ${window.usedPercent}%`;
  }
  return `${window.label} ${window.usedPercent}% (${formatRemaining(window.resetAtMs - now)})`;
}

function titlePlan(plan: string | null): string | null {
  if (!plan) {
    return null;
  }
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatWhen(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*|]/g, "\\$&");
}

function inlineCode(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}
