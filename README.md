# AgentDashboard

A Webex Contact Center Agent Desktop widget that shows who is signed in, what they're doing, and how long they've been doing it. Cards are grouped by state, so "is anyone free?" is answered at a glance. It can also show how many contacts are waiting in the queues you choose.

## What it shows

| Column | Meaning |
|--------|---------|
| **Available** | Ready for the next call. Sorted with the longest-waiting agent first, so the top card is who's next. |
| **On a call** | Ringing, connected, on hold, consulting or in a conference |
| **Wrap-up** | Finishing up after a call |
| **Idle** | Signed in but not taking calls, including any idle or break state |

Each card has the agent's name, their team, and a live clock for time in the current state. The clock is correct as soon as the page loads, because it comes from WxCC's own last-activity time and not from when the page was opened.

If you list queues, a strip under the board shows **Waiting** and **Longest wait** for each.

## How it works

The widget reads the WxCC **Search API** as the signed-in user. It uses only the token, org and data center the Desktop already has. There's no server, no separate sign-in and no credentials to store.

- **Who appears is whatever the user's role allows.** A supervisor sees their agents; an agent with a narrower role sees less. The widget has no access list of its own.
- **Refreshes every 15 seconds**, with the clocks ticking every second in between.
- **If a refresh fails**, it keeps showing the last good data and says so, and it warns when the data is over a minute old.
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
| `data-center` | Yes | `us1`, `eu1`, `eu2`, `anz1` or `ca1`, from `$STORE.app.datacenter` |
| `darkmode` | No | `$STORE.app.darkMode`. Matches the Desktop's light or dark theme |
| `team-name` | No | Show only this team, by its exact name. If left out, it shows everyone the user is allowed to see. |
| `queues` | No | Queues to show waiting numbers for, as `id:Name` pairs separated by commas, e.g. `"<queue-id>:Technical Support,<queue-id>:Billing"` |

## Known limitations

- **Signed-out agents aren't shown.** The Search API only lists active sessions.
- **Only the first page of agents is loaded.** A very large org may not show everyone.
- **State names come straight from WxCC.** Anything the widget doesn't recognise is grouped under Idle. The idle or break reason (Lunch, Meeting, and so on) isn't shown yet.
- **No extension numbers yet.**

## License

See [LICENSE](LICENSE).
