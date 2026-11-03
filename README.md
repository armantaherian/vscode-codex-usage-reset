# Codex Usage

Author: [Arman Taherian](https://github.com/armantaherian)

A VS Code and Cursor status bar item for the Codex login already on this machine.

```text
Codex 5h 12% (3h 12m) · Wk 41% (4d 2h) · Ctx 93% · ↺ 3
```

- **5h** and **Wk** are how much of that quota is used. The time in parentheses is how long until that window resets.
- **Ctx** is context remaining in the latest Codex session for the open workspace.
- **↺** is how many banked rate-limit resets are available. The extension only shows the count. It does not redeem one.

Hover the item for the plan, exact reset time, tokens left in the context window, the next banked-reset expiry, and a GitHub-style tile grid of the last 7 days. Each square is one hour on a weekday, and darker green means more usage. Click it to refresh. The bar turns yellow around 75% used and red around 90%.

Usage comes from the same Codex endpoint the CLI polls (`GET /backend-api/wham/usage`), using `~/.codex/auth.json`. If that login is expired, the extension refreshes it the same way Codex does and writes the new token back. Context comes from the newest local rollout under `~/.codex/sessions`. When the live request fails, the last session snapshot stays on the bar and the item shows a warning.

## Install

Install **Codex Usage Reset** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ArmanTaherian.codex-usage-reset).

In VS Code, open Quick Open (`Ctrl+P` or `Cmd+P`), paste this, and press Enter:

```text
ext install ArmanTaherian.codex-usage-reset
```

The same build is also in this repo as `codex-usage-reset-0.1.2.vsix`. Use **Extensions: Install from VSIX…** if the Marketplace is not available.

## Run

```sh
npm install
npm test
```

Open this folder in VS Code or Cursor and press F5. That starts an Extension Development Host with the status bar item loaded.

Set `codexUsage.codexHome` if Codex lives somewhere other than `CODEX_HOME` or `~/.codex`. `codexUsage.refreshSeconds` defaults to 60, and the countdown redraws every 15 seconds.
