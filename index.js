(() => {
  if (customElements.get('agent-dashboard')) return;

  const DEFAULTS = {
    dataCenter: 'us1',
    channel: 'telephony',
    refreshSeconds: 15,
    staleSeconds: 60,
    lookbackHours: 24,
  };

  const QUEUE_LIST_TTL_MS = 15 * 60 * 1000;

  const COLUMNS = [
    ['available', 'Available'],
    ['onCall', 'On a call'],
    ['wrapup', 'Wrap-up'],
    ['idle', 'Idle'],
  ];

  const BUSY_WORDS = ['connected', 'ringing', 'held', 'hold', 'consult', 'conferenc', 'engaged', 'talking', 'reserved'];

  function groupFor(state) {
    const s = String(state || '').toLowerCase();
    if (s.includes('available')) return 'available';
    if (s.includes('wrap')) return 'wrapup';
    if (BUSY_WORDS.some((w) => s.includes(w))) return 'onCall';
    return 'idle';
  }

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

  const positive = (value, fallback) => {
    const n = Number(value);
    return n > 0 ? n : fallback;
  };

  function parseQueues(attr) {
    return String(attr || '').split(',').map((part) => {
      const i = part.indexOf(':');
      const id = (i < 0 ? part : part.slice(0, i)).trim();
      const name = i < 0 ? '' : part.slice(i + 1).trim();
      return { id, name: name || 'Queue' };
    }).filter((q) => q.id);
  }

  const AGENT_QUERY_HEAD = 'query agents($from:Long! $to:Long! $filter:AgentSessionFilters $extFilter:AgentSessionSpecificFilters $pagination:Pagination){agentSession(from:$from to:$to filter:$filter extFilter:$extFilter pagination:$pagination){agentSessions{';

  const TYPE_REF = 'name kind ofType { name kind ofType { name kind ofType { name kind } } }';

  const QUEUE_QUERY = 'query queue($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{aggregation{name value}}}}';

  const ALL_QUEUES_QUERY = 'query queues($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{lastQueue{name} aggregation{name value}}}}';

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
    .reason { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; }
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
      return ['token', 'org-id', 'data-center', 'base-url', 'channel', 'refresh-seconds',
              'stale-seconds', 'lookback-hours', 'darkmode', 'team-name', 'queues', 'debug'];
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
      this.startPolling();
      this.ticker = setInterval(() => this.tick(), 1000);
    }

    disconnectedCallback() {
      clearInterval(this.poll);
      clearInterval(this.ticker);
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'darkmode') this.toggleAttribute('dark', String(val) === 'true');
      if (!this.isConnected) return;
      if (name === 'refresh-seconds') this.startPolling();
      else if (name !== 'darkmode') this.refresh();
    }

    startPolling() {
      clearInterval(this.poll);
      this.poll = setInterval(() => this.refresh(), this.refreshMs);
    }

    get token() { return this.getAttribute('token') || ''; }
    get orgId() { return this.getAttribute('org-id') || ''; }
    get channel() { return this.getAttribute('channel') || DEFAULTS.channel; }
    get refreshMs() { return positive(this.getAttribute('refresh-seconds'), DEFAULTS.refreshSeconds) * 1000; }
    get staleMs() { return positive(this.getAttribute('stale-seconds'), DEFAULTS.staleSeconds) * 1000; }
    get lookbackMs() { return positive(this.getAttribute('lookback-hours'), DEFAULTS.lookbackHours) * 3600000; }
    get dataCenter() {
      const raw = String(this.getAttribute('data-center') || '').toLowerCase();
      const match = raw.match(/(?:anz|us|eu|ca|uk|jp|sg)\d+/);
      return match ? match[0] : DEFAULTS.dataCenter;
    }
    get base() {
      const explicit = (this.getAttribute('base-url') || '').trim().replace(/\/+$/, '');
      return explicit || `https://api.wxcc-${this.dataCenter}.cisco.com`;
    }

    async search(query, variables) {
      let res;
      try {
        res = await fetch(`${this.base}/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', Accept: 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        throw new Error(`Could not reach ${this.base} (data-center "${this.getAttribute('data-center') || ''}").`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('Your session does not allow this view, or it has expired. Sign in again.');
      }
      if (!res.ok) throw new Error(`The WxCC Search API answered ${res.status}.`);
      const body = await res.json();
      if (body.errors && body.errors.length) throw new Error(body.errors[0].message || 'Search error');
      return body.data;
    }

    unwrap(type) {
      let t = type;
      while (t && (t.kind === 'LIST' || t.kind === 'NON_NULL') && t.ofType) t = t.ofType;
      return t || {};
    }

    async fieldsOf(typeName) {
      const data = await this.search(`{ __type(name: "${typeName}") { fields { name type { ${TYPE_REF} } } } }`, {});
      return (data.__type && data.__type.fields) || [];
    }

    async discoverIdleFields() {
      if (this.idleFields !== undefined) return this.idleFields;
      this.idleFields = null;
      try {
        const root = await this.search(`{ __schema { queryType { fields { name type { ${TYPE_REF} } } } } }`, {});
        const entry = root.__schema.queryType.fields.find((f) => f.name === 'agentSession');
        const wrapperFields = await this.fieldsOf(this.unwrap(entry.type).name);
        const sessions = wrapperFields.find((f) => f.name === 'agentSessions');
        const sessionFields = await this.fieldsOf(this.unwrap(sessions.type).name);
        const channel = sessionFields.find((f) => f.name === 'channelInfo');
        const channelFields = channel ? await this.fieldsOf(this.unwrap(channel.type).name) : [];
        const pick = (fields) => fields
          .filter((f) => ['SCALAR', 'ENUM'].includes(this.unwrap(f.type).kind))
          .map((f) => f.name)
          .filter((n) => /idle/i.test(n));
        const found = { session: pick(sessionFields), channel: pick(channelFields) };
        if (found.session.length || found.channel.length) this.idleFields = found;
        if (this.hasAttribute('debug')) console.info('[agent-dashboard] idle fields', found);
      } catch (err) {
        if (this.hasAttribute('debug')) console.info('[agent-dashboard] schema discovery failed', err);
      }
      return this.idleFields;
    }

    agentQuery(extra) {
      const top = ['agentId', 'agentName', 'teamName', 'startTime', ...(extra ? extra.session : [])].join(' ');
      const channel = ['currentState', 'lastActivityTime', ...(extra ? extra.channel : [])].join(' ');
      return `${AGENT_QUERY_HEAD}${top} channelInfo{${channel}}}}}`;
    }

    async loadIdleCodeNames() {
      const now = Date.now();
      if (this.idleCodeNames && now - this.idleCodeNamesAt < QUEUE_LIST_TTL_MS) return this.idleCodeNames;
      const names = {};
      try {
        const filter = encodeURIComponent('active==true;workTypeCode==IDLE_CODE');
        const res = await fetch(
          `${this.base}/organization/${this.orgId}/v2/auxiliary-code?page=0&pageSize=100&filter=${filter}`,
          { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } },
        );
        if (res.ok) {
          const body = await res.json();
          const rows = Array.isArray(body) ? body : (body.data || []);
          for (const c of rows) if (c && c.id && c.name) names[c.id] = c.name;
        }
      } catch (err) {
        return {};
      }
      this.idleCodeNames = names;
      this.idleCodeNamesAt = now;
      return names;
    }

    reasonFrom(session, channel, extra, codeNames) {
      if (!extra) return '';
      const values = [
        ...extra.channel.map((n) => [n, channel[n]]),
        ...extra.session.map((n) => [n, session[n]]),
      ].filter(([, v]) => v);
      const named = values.find(([n]) => /name/i.test(n));
      if (named) return String(named[1]);
      const id = values.length ? String(values[0][1]) : '';
      return codeNames[id] || '';
    }

    async loadAgents() {
      const now = Date.now();
      const variables = {
        from: `${now - this.lookbackMs}`, to: `${now}`,
        filter: { and: [{ isActive: { equals: true } }, { channelInfo: { channelType: { equals: this.channel } } }] },
        extFilter: {}, pagination: {},
      };
      let extra = await this.discoverIdleFields();
      let data;
      try {
        data = await this.search(this.agentQuery(extra), variables);
      } catch (err) {
        if (!extra) throw err;
        this.idleFields = null;
        extra = null;
        data = await this.search(this.agentQuery(null), variables);
      }
      const codeNames = extra ? await this.loadIdleCodeNames() : {};
      const team = (this.getAttribute('team-name') || '').trim().toLowerCase();
      return (data.agentSession.agentSessions || [])
        .map((s) => {
          const ch = (s.channelInfo && s.channelInfo[0]) || {};
          const group = groupFor(ch.currentState);
          return {
            id: s.agentId, name: s.agentName || 'Unknown', team: s.teamName || '',
            state: ch.currentState || '', group,
            reason: group === 'idle' ? this.reasonFrom(s, ch, extra, codeNames) : '',
            since: Number(ch.lastActivityTime) || Number(s.startTime) || now,
          };
        })
        .filter((a) => !team || a.team.toLowerCase() === team);
    }

    aggregates(row) {
      const agg = {};
      for (const a of row.aggregation || []) agg[a.name] = a.value;
      return { waiting: Number(agg.waiting) || 0, oldest: Number(agg.oldest) || 0 };
    }

    waitingAggregations() {
      return [
        { field: 'id', type: 'count', name: 'waiting' },
        { field: 'createdTime', type: 'min', name: 'oldest' },
      ];
    }

    async loadQueueCatalog() {
      const now = Date.now();
      if (this.queueCatalog && now - this.queueCatalogAt < QUEUE_LIST_TTL_MS) return this.queueCatalog;
      try {
        const queues = [];
        let page = 0;
        let totalPages = 1;
        while (page < totalPages && page < 20) {
          const res = await fetch(
            `${this.base}/organization/${this.orgId}/v2/contact-service-queue?page=${page}&pageSize=100`,
            { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } },
          );
          if (!res.ok) throw new Error(String(res.status));
          const body = await res.json();
          const rows = Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []);
          for (const q of rows) if (q && q.name && q.active !== false) queues.push({ id: q.id, name: q.name });
          totalPages = (body.meta && body.meta.totalPages) || 1;
          page += 1;
        }
        this.queueCatalog = queues;
        this.queueCatalogAt = now;
      } catch (err) {
        this.queueCatalog = null;
        this.queueCatalogAt = now - QUEUE_LIST_TTL_MS + 60000;
      }
      return this.queueCatalog;
    }

    async loadQueues() {
      const pinned = parseQueues(this.getAttribute('queues'));
      const now = Date.now();
      const from = `${now - this.lookbackMs}`;
      const to = `${now}`;
      const waiting = [{ isActive: { equals: true } }, { status: { equals: 'parked' } }];

      if (!pinned.length) {
        const [catalog, data] = await Promise.all([
          this.loadQueueCatalog(),
          this.search(ALL_QUEUES_QUERY, {
            from, to, timeComparator: 'createdTime',
            filter: { and: waiting }, aggregations: this.waitingAggregations(),
          }),
        ]);
        const byName = new Map();
        for (const row of data.task.tasks || []) {
          const name = (row.lastQueue && row.lastQueue.name) || 'Queue';
          byName.set(name, this.aggregates(row));
        }
        const names = catalog ? catalog.map((q) => q.name) : [...byName.keys()];
        for (const name of byName.keys()) if (!names.includes(name)) names.push(name);
        return names
          .map((name) => ({ name, ...(byName.get(name) || { waiting: 0, oldest: 0 }) }))
          .sort((a, b) => (b.waiting - a.waiting) || a.name.localeCompare(b.name));
      }

      return Promise.all(pinned.map(async ({ id, name }) => {
        const data = await this.search(QUEUE_QUERY, {
          from, to, timeComparator: 'createdTime',
          filter: { and: [...waiting, { lastQueue: { id: { equals: id } } }] },
          aggregations: this.waitingAggregations(),
        });
        const totals = { waiting: 0, oldest: 0 };
        for (const row of data.task.tasks || []) {
          const a = this.aggregates(row);
          totals.waiting += a.waiting;
          if (a.oldest && (!totals.oldest || a.oldest < totals.oldest)) totals.oldest = a.oldest;
        }
        return { name, ...totals };
      }));
    }

    async refresh() {
      if (!this.token || !this.orgId) return;
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
      for (const list of Object.values(byGroup)) list.sort((a, b) => a.since - b.since);

      const chips = COLUMNS.map(([k, label]) =>
        `<span class="chip ${k}"><i></i>${byGroup[k].length} ${label}</span>`).join('');

      const cols = COLUMNS.map(([k, label]) => `
        <div class="col">
          <h3>${label}<span>${byGroup[k].length}</span></h3>
          <div class="list">${byGroup[k].length ? byGroup[k].map((a) => `
            <div class="card ${k}">
              <div class="name" title="${esc(a.name)}">${esc(a.name)}</div>
              <div class="meta"><span class="reason">${esc(a.reason)}</span><span class="time" data-since="${a.since}">${clock(now - a.since)}</span></div>
            </div>`).join('') : '<div class="none">Nobody</div>'}</div>
        </div>`).join('');

      const notice = this.error
        ? `<div class="notice warn">${esc(this.error)} Showing the last known data.</div>` : '';

      const queueCards = this.queueStats.length
        ? this.queueStats.map((q) => `
        <div class="q ${q.waiting ? 'hot' : ''}">
          <b>${esc(q.name)}</b>
          <div class="row">
            <div><div class="n">${q.waiting}</div><div class="l">Waiting</div></div>
            <div><div class="n wait time" ${q.waiting ? `data-since="${q.oldest}"` : ''}>${q.waiting ? clock(now - q.oldest) : '--:--'}</div><div class="l">Longest wait</div></div>
          </div>
        </div>`).join('')
        : '<div class="q"><b>Queues</b><div class="row"><div><div class="n">0</div><div class="l">Contacts waiting</div></div></div></div>';
      const queues = `<div class="queues">${queueCards}</div>`;

      this.root.innerHTML = `${notice}<div class="summary">${chips}</div><div class="board">${cols}</div>${queues}`;
    }

    tick() {
      const now = Date.now();
      this.shadowRoot.querySelectorAll('[data-since]').forEach((el) => {
        el.textContent = clock(now - Number(el.dataset.since));
      });
      if (this.lastGood && now - this.lastGood > this.staleMs && !this.error) {
        this.error = 'The data has not refreshed recently.';
        this.render();
      }
    }
  }

  customElements.define('agent-dashboard', AgentDashboard);
})();
