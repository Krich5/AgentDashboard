/**
 * AgentDashboard — a Webex Contact Center Agent Desktop widget.
 *
 * Shows who is signed in, what they are doing, and how long they have been doing it, as cards
 * grouped by state. Optionally shows live waiting numbers for chosen queues.
 *
 * It needs only what the Desktop already has: the user's access token, the org ID and the data
 * center. It reads the WxCC Search API as that user, so what appears is whatever their role is
 * allowed to see. There is no server behind it.
 *
 *   <agent-dashboard token="…" org-id="…" data-center="us1"></agent-dashboard>
 */
(() => {
  if (customElements.get('agent-dashboard')) return;

  const API_BASE = {
    us1: 'https://api.wxcc-us1.cisco.com',
    eu1: 'https://api.wxcc-eu1.cisco.com',
    eu2: 'https://api.wxcc-eu2.cisco.com',
    anz1: 'https://api.wxcc-anz1.cisco.com',
    ca1: 'https://api.wxcc-ca1.cisco.com',
  };

  const REFRESH_MS = 15000;      // how often the data is fetched
  const STALE_MS = 60000;        // how old the data can get before the board says so
  const LOOKBACK_MS = 24 * 60 * 60 * 1000;

  // Display order, and the label for each group of states.
  const COLUMNS = [
    ['available', 'Available'],
    ['onCall', 'On a call'],
    ['wrapup', 'Wrap-up'],
    ['idle', 'Idle'],
  ];

  /** Which column a WxCC channel state belongs in. Anything unrecognised is Idle. */
  function groupFor(state) {
    const s = String(state || '').toLowerCase();
    if (s.includes('available')) return 'available';
    if (s.includes('wrap')) return 'wrapup';
    const busy = ['connected', 'ringing', 'held', 'hold', 'consult', 'conferenc', 'engaged', 'talking', 'reserved'];
    if (busy.some((w) => s.includes(w))) return 'onCall';
    return 'idle';
  }

  /** 83 -> "01:23", 3725 -> "1:02:05" */
  function clock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /** "id:Name,id:Name" -> [{id, name}] */
  function parseQueues(attr) {
    return String(attr || '').split(',').map((part) => {
      const i = part.indexOf(':');
      const id = (i < 0 ? part : part.slice(0, i)).trim();
      const name = i < 0 ? '' : part.slice(i + 1).trim();
      return { id, name: name || 'Queue' };
    }).filter((q) => q.id);
  }

  const AGENT_QUERY = 'query agents($from:Long! $to:Long! $filter:AgentSessionFilters $extFilter:AgentSessionSpecificFilters $pagination:Pagination){agentSession(from:$from to:$to filter:$filter extFilter:$extFilter pagination:$pagination){agentSessions{agentId agentName teamName startTime channelInfo{currentState lastActivityTime}}}}';

  const QUEUE_QUERY = 'query queue($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{aggregation{name value}}}}';

  const STYLE = `
    :host {
      --bg: #ffffff; --fg: #121212; --muted: #5d6874; --line: #d9dee3;
      --available: #1a9c33; --onCall: #d9342b; --wrapup: #7b4fc9; --idle: #d89a00;
      display: block; font-family: 'CiscoSansTT Regular', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      color: var(--fg);
    }
    :host([dark]) { --bg: #1f2327; --fg: #e8eaed; --muted: #a3acb5; --line: #353b41; }
    .wrap { padding: 12px; }
    .summary { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .chip { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); }
    .chip i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .board { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(150px, 1fr)); align-items: start; }
    @media (max-width: 760px) { .board { grid-template-columns: repeat(2, minmax(140px, 1fr)); } }
    .col h3 { font-size: 13px; margin: 0 0 6px; }
    .col h3 span { font-weight: 400; color: var(--muted); margin-left: 4px; }
    .list { display: flex; flex-direction: column; gap: 6px; max-height: 460px; overflow-y: auto; }
    .card { background: var(--bg); border: 1px solid var(--line); border-left-width: 4px; border-radius: 6px; padding: 6px 8px; }
    .name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 2px; }
    .time { font-variant-numeric: tabular-nums; }
    .none { font-size: 12px; color: var(--muted); padding: 4px 2px; }
    .available { border-left-color: var(--available); } .chip.available i { background: var(--available); }
    .onCall    { border-left-color: var(--onCall); }    .chip.onCall i    { background: var(--onCall); }
    .wrapup    { border-left-color: var(--wrapup); }    .chip.wrapup i    { background: var(--wrapup); }
    .idle      { border-left-color: var(--idle); }      .chip.idle i      { background: var(--idle); }
    .queues { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 10px; display: grid; gap: 10px;
              grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .q { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
    .q b { display: block; font-size: 13px; margin-bottom: 4px; }
    .q .row { display: flex; gap: 18px; }
    .q .n { font-size: 22px; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .q .l { font-size: 11px; color: var(--muted); }
    .q.hot .n.wait { color: var(--onCall); }
    .notice { font-size: 12px; padding: 6px 8px; border-radius: 6px; margin-bottom: 10px; }
    .warn { background: #fdf3e0; color: #7a4a06; }
    .bad { background: #fbe7e7; color: #8a1c1c; }
    :host([dark]) .warn { background: #3a2f17; color: #eac27a; }
    :host([dark]) .bad { background: #3b1f1f; color: #f0a0a0; }
  `;

  class AgentDashboard extends HTMLElement {
    static get observedAttributes() {
      return ['token', 'org-id', 'data-center', 'darkmode', 'team-name', 'queues'];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="wrap"></div>`;
      this.root = this.shadowRoot.querySelector('.wrap');
      this.agents = [];
      this.queueStats = [];
      this.lastGood = 0;
      this.error = '';
    }

    connectedCallback() {
      this.refresh();
      this.poll = setInterval(() => this.refresh(), REFRESH_MS);
      // The clocks tick on their own so time moves smoothly between fetches.
      this.ticker = setInterval(() => this.tick(), 1000);
    }

    disconnectedCallback() {
      clearInterval(this.poll);
      clearInterval(this.ticker);
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'darkmode') this.toggleAttribute('dark', String(val) === 'true');
      else if (this.isConnected) this.refresh();
    }

    get token() { return this.getAttribute('token') || ''; }
    get orgId() { return this.getAttribute('org-id') || ''; }
    get base() { return API_BASE[this.getAttribute('data-center')] || API_BASE.us1; }

    async search(query, variables) {
      const res = await fetch(`${this.base}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error('Your session does not allow this view, or it has expired. Sign in again.');
      }
      if (!res.ok) throw new Error(`The WxCC Search API answered ${res.status}.`);
      const body = await res.json();
      if (body.errors && body.errors.length) throw new Error(body.errors[0].message || 'Search error');
      return body.data;
    }

    async loadAgents() {
      const now = Date.now();
      const data = await this.search(AGENT_QUERY, {
        from: `${now - LOOKBACK_MS}`, to: `${now}`,
        filter: { and: [{ isActive: { equals: true } }, { channelInfo: { channelType: { equals: 'telephony' } } }] },
        extFilter: {}, pagination: {},
      });
      const team = (this.getAttribute('team-name') || '').trim().toLowerCase();
      return (data.agentSession.agentSessions || [])
        .map((s) => {
          const ch = (s.channelInfo && s.channelInfo[0]) || {};
          return {
            id: s.agentId, name: s.agentName || 'Unknown', team: s.teamName || '',
            state: ch.currentState || '', group: groupFor(ch.currentState),
            since: Number(ch.lastActivityTime) || Number(s.startTime) || now,
          };
        })
        .filter((a) => !team || a.team.toLowerCase() === team);
    }

    async loadQueues() {
      const queues = parseQueues(this.getAttribute('queues'));
      const now = Date.now();
      return Promise.all(queues.map(async ({ id, name }) => {
        const data = await this.search(QUEUE_QUERY, {
          from: `${now - LOOKBACK_MS}`, to: `${now}`, timeComparator: 'createdTime',
          filter: { and: [
            { isActive: { equals: true } }, { status: { equals: 'parked' } },
            { lastQueue: { id: { equals: id } } },
          ] },
          aggregations: [
            { field: 'id', type: 'count', name: 'waiting' },
            { field: 'createdTime', type: 'min', name: 'oldest' },
          ],
        });
        const agg = {};
        for (const row of data.task.tasks || []) {
          for (const a of row.aggregation || []) agg[a.name] = a.value;
        }
        return { name, waiting: Number(agg.waiting) || 0, oldest: Number(agg.oldest) || 0 };
      }));
    }

    async refresh() {
      if (!this.token || !this.orgId) return;       // the Desktop fills these in a moment after load
      try {
        const [agents, queueStats] = await Promise.all([this.loadAgents(), this.loadQueues()]);
        this.agents = agents;
        this.queueStats = queueStats;
        this.lastGood = Date.now();
        this.error = '';
      } catch (err) {
        this.error = (err && err.message) || String(err);
      }
      this.render();
    }

    render() {
      const now = Date.now();
      if (this.error && !this.lastGood) {
        this.root.innerHTML = `<div class="notice bad">${esc(this.error)}</div>`;
        return;
      }
      if (!this.lastGood) {
        this.root.innerHTML = '<div class="none">Loading…</div>';
        return;
      }

      const byGroup = {};
      for (const [key] of COLUMNS) byGroup[key] = [];
      for (const a of this.agents) byGroup[a.group].push(a);
      // Longest in their state first: in Available that is the person who has waited longest.
      for (const list of Object.values(byGroup)) list.sort((a, b) => a.since - b.since);

      const chips = COLUMNS.map(([k, label]) =>
        `<span class="chip ${k}"><i></i>${byGroup[k].length} ${label}</span>`).join('');

      const cols = COLUMNS.map(([k, label]) => `
        <div class="col">
          <h3>${label}<span>${byGroup[k].length}</span></h3>
          <div class="list">${byGroup[k].length ? byGroup[k].map((a) => `
            <div class="card ${k}">
              <div class="name" title="${esc(a.name)}">${esc(a.name)}</div>
              <div class="meta"><span>${esc(a.team)}</span><span class="time" data-since="${a.since}">${clock(now - a.since)}</span></div>
            </div>`).join('') : '<div class="none">Nobody</div>'}</div>
        </div>`).join('');

      let notice = '';
      if (this.error) notice = `<div class="notice warn">${esc(this.error)} Showing the last known data.</div>`;

      const queues = this.queueStats.length ? `<div class="queues">${this.queueStats.map((q) => `
        <div class="q ${q.waiting ? 'hot' : ''}">
          <b>${esc(q.name)}</b>
          <div class="row">
            <div><div class="n">${q.waiting}</div><div class="l">Waiting</div></div>
            <div><div class="n wait time" ${q.waiting ? `data-since="${q.oldest}"` : ''}>${q.waiting ? clock(now - q.oldest) : '--:--'}</div><div class="l">Longest wait</div></div>
          </div>
        </div>`).join('')}</div>` : '';

      this.root.innerHTML = `${notice}<div class="summary">${chips}</div><div class="board">${cols}</div>${queues}`;
    }

    /** Once a second: move the clocks, and flag data that has gone stale. */
    tick() {
      const now = Date.now();
      this.shadowRoot.querySelectorAll('[data-since]').forEach((el) => {
        el.textContent = clock(now - Number(el.dataset.since));
      });
      if (this.lastGood && now - this.lastGood > STALE_MS && !this.error) {
        this.error = 'Not updated for over a minute.';
        this.render();
      }
    }
  }

  customElements.define('agent-dashboard', AgentDashboard);
})();
