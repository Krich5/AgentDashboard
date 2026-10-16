# AgentDashboard

A Webex Contact Center Agent Desktop widget that shows who is signed in, what they're doing, and how long they've been doing it. Cards are grouped by state, so "is anyone free?" is answered at a glance. It can also show how many contacts are waiting in the queues you choose.

## What it shows

| Column | Meaning |
|--------|---------|
| **Available** | Ready for the next call. Sorted with the longest-waiting agent first, so the top card is who's next. |
| **On a call** | Ringing, connected, on hold, consulting or in a conference |
| **Wrap-up** | Finishing up after a call |
| **Idle** | Signed in but not taking calls, with the idle code shown on the card |

Each card has the agent's name and a live clock for time in the current state. Idle cards also show the **idle code** (Lunch, Meeting and so on) when WxCC provides it. The clock is correct as soon as the page loads, because it comes from WxCC's own last-activity time and not from when the page was opened.

Under the board, a strip shows the queues the signed-in agent's **desktop profile** allows them to see (Agent Statistics → Queue statistics in Control Hub: All, None or Specific), with the number **Waiting**, the **Longest wait**, and today's **Offered** and **Abandoned** counts. Queues with contacts waiting come first. With "None", no strip is shown. If the profile can't be read, the strip says so and shows no queues.

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
| `stale-seconds` | No | How long before the board warns the data is old. Default `60` |
| `lookback-hours` | No | How far back to search for active sessions and waiting contacts. Default `24` |
| `debug` | No | Logs to the browser console which idle-code fields the Search API offered |
| `team-name` | No | Show only this team, by its exact name. If left out, it shows everyone the user is allowed to see. |
| `queues` | No | Pin specific queues so they always show, even with nothing waiting, as `id:Name` pairs separated by commas, e.g. `"<queue-id>:Technical Support,<queue-id>:Billing"`. If left out, the queues allowed by the agent's desktop profile are shown. |

## Known limitations

- **Offered and Abandoned count from midnight, local time.** They're tallied from contact records created today. Abandoned appears only if the Search API exposes a contact outcome field; otherwise only Offered is shown. Add the `debug` attribute to see in the console whether it was found.
- **No service level or requeued count yet.** Those need a service-level threshold and extra fields.
- **Signed-out agents aren't shown.** The Search API only lists active sessions.
- **Only the first page of agents is loaded.** A very large org may not show everyone.
- **State names come straight from WxCC.** Anything the widget doesn't recognise is grouped under Idle.
- **Idle codes depend on what the Search API offers.** The widget asks the API which idle-code fields exist the first time it loads. If the API offers none, Idle cards show no reason. Add the `debug` attribute to see in the browser console which fields were found.
- **No extension numbers yet.**

## License

See [LICENSE](LICENSE).
