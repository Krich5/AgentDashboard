# AgentDashboard

A Webex Contact Center Agent Desktop widget that shows who is signed in, what they're doing, and how long they've been doing it. Cards are grouped by state, so "is anyone free?" is answered at a glance. It can also show how many contacts are waiting in the queues you choose.

## What it shows

| Column | Meaning |
|--------|---------|
| **Available** | Ready for the next call. Sorted with the longest-waiting agent first, so the top card is who's next. |
| **On a call** | Ringing, connected, on hold, consulting or in a conference |
| **Wrap-up** | Finishing up after a call |
| **Idle** | Signed in but not taking calls, with the idle code shown on the card |

Each agent is one compact row. Each column shows up to fifteen rows at a time and scrolls when there are more. Available and Wrap-up rows show the name and a live clock for time in that state. On a call rows add the call state (connected, hold, conference and so on) between the name and the clock. Idle rows add the idle code (Lunch, Meeting and so on) when WxCC provides it.

Under the board, a table lists the queues the signed-in agent's **desktop profile** allows them to see (Agent Statistics → Queue statistics in Control Hub: All, None or Specific). Each queue has its **Waiting** count, **Longest wait**, and today's **Offered**, **Handled** and **Abandoned** counts, with a total row that stays visible while the queues scroll. Queues with contacts waiting come first. **Waiting** and **Longest wait** turn yellow and then red as they pass the thresholds (see the attributes below), and the other columns stay plain. The whole widget sizes itself to the window, sharing the height between the agent columns and the table, so the page doesn't scroll. With "None", no table is shown. If the profile can't be read, it says so and shows no queues.

**Resizing.** Drag the divider between the agents and the queue table to give one more room. Your position is remembered in the browser, so it's the same next time you sign in on that computer. Double-click the divider to put it back to the default, or focus it and use the up and down arrow keys.

## How it works

The widget reads the WxCC **Search API** as the signed-in user. It uses only the token, org and data center the Desktop already has. There's no server, no separate sign-in and no credentials to store.

- **Who appears is whatever the user's role allows.** A supervisor sees their agents; an agent with a narrower role sees less. The widget has no access list of its own.
- **Refreshes every 15 seconds** by default (`refresh-seconds`), with the clocks ticking every second in between.
- **If a refresh fails**, it keeps showing the last good data and says so, and it warns when the data has gone stale (`stale-seconds`).
- Only signed-in agents on the telephony channel are listed. Signed-out agents don't appear.

## Install

### 1. Host the script

With GitHub Pages turned on for this repo (Settings → Pages → `main` / root), the script is served at:

```
https://krich5.github.io/AgentDashboard/index.js
```

### 2. Add it to your Desktop Layout

Add a navigation page to the persona that should have it (usually `supervisor` and `supervisorAgent`):

```json
{
  "nav": {
    "label": "Agent Dashboard",
    "icon": "contact-card",
    "iconType": "momentum",
    "navigateTo": "AgentDashboard",
    "align": "top"
  },
  "page": {
    "id": "AgentDashboard",
    "widgets": {
      "comp1": {
        "comp": "agent-dashboard",
        "script": "https://krich5.github.io/AgentDashboard/index.js",
        "attributes": {
          "token": "$STORE.auth.accessToken",
          "org-id": "$STORE.agent.orgId",
          "data-center": "$STORE.app.datacenter",
          "agent-profile-id": "$STORE.agent.agentProfileID",
          "darkmode": "$STORE.app.darkMode"
        }
      }
    },
    "layout": {
      "areas": [["comp1"]],
      "size": { "cols": [1], "rows": [1] }
    }
  }
}
```

The same snippet is in [`Desktop_Layout_Snippet.json`](Desktop_Layout_Snippet.json).

### 3. Upload the layout

In **Control Hub → Contact Center → Desktop Layouts**, upload the layout and assign it to your supervisor teams. Users must sign out and back in to pick it up.

## Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `token` | Yes | The user's access token, `$STORE.auth.accessToken` |
| `org-id` | Yes | WxCC organization ID, `$STORE.agent.orgId` |
| `agent-profile-id` | Yes, for queues | The agent's desktop profile ID, `$STORE.agent.agentProfileID`. The widget reads the profile to see which queues the agent may view |
| `data-center` | Yes | `us1`, `eu1`, `eu2`, `anz1` or `ca1`, from `$STORE.app.datacenter` |
| `darkmode` | No | `$STORE.app.darkMode`. Matches the Desktop's light or dark theme |
| `base-url` | No | Use this API address instead of the one built from `data-center` |
| `channel` | No | The channel to list agents on. Default `telephony` |
| `refresh-seconds` | No | How often data is fetched. Default `15` |
| `rows` | No | How many agent rows each column shows before it scrolls. Default `15` |
| `queue-rows` | No | The most queue rows the table shows before it scrolls. The header and Total row stay in place. Default `5` |
| `waiting-warn` / `waiting-alert` | No | A queue's Waiting count turns yellow at `waiting-warn` and red at `waiting-alert`. Defaults `5` and `10` |
| `wait-warn-seconds` / `wait-alert-seconds` | No | Longest wait turns yellow at `wait-warn-seconds` and red at `wait-alert-seconds`. Defaults `120` and `300` |
| `fit` | No | By default the widget sizes itself to the browser window so the page never scrolls. Set `false` to turn that off |
| `stale-seconds` | No | How long before the board warns the data is old. Default `60` |
| `lookback-hours` | No | How far back to search for active sessions and waiting contacts. Default `24` |
| `debug` | No | Shows a panel at the bottom with which idle-code and outcome fields the Search API accepted, and today's contact outcomes |
| `team-name` | No | Show only this team, by its exact name. If left out, it shows everyone the user is allowed to see. |
| `queues` | No | Pin specific queues so they always show, even with nothing waiting, as `id:Name` pairs separated by commas, e.g. `"<queue-id>:Technical Support,<queue-id>:Billing"`. If left out, the queues allowed by the agent's desktop profile are shown. |

## Known limitations

- **Offered, Handled and Abandoned count from midnight, local time**, using the same definitions as the Analyzer reports. Abandoned counts contacts whose Termination Type is `abandoned`. Handled counts contacts whose Handle Type is `normal` or `sudden_disconnect`. If the Search API doesn't offer Handle Type, Handled falls back to contacts that ended normally and is approximate. Add the `debug` attribute to see which fields were used and today's outcome counts.
- **No service level or requeued count yet.** Those need a service-level threshold and extra fields.
- **Signed-out agents aren't shown.** The Search API only lists active sessions.
- **Only the first page of agents is loaded.** A very large org may not show everyone.
- **State names come straight from WxCC.** Anything the widget doesn't recognise is grouped under Idle.
- **Idle codes depend on what the Search API accepts.** The widget tries the likely idle-code fields once and keeps the first one the API accepts. If none is accepted, Idle cards show no reason.
- **No extension numbers yet.**

## License

See [LICENSE](LICENSE).
