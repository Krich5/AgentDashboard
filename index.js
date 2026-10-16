(() => {
  if (customElements.get('agent-dashboard')) return;

  const DEFAULTS = {
    dataCenter: 'us1',
    channel: 'telephony',
    refreshSeconds: 15,
    visibleRows: 5,
    queueRows: 6,
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

  const prettyState = (state) => {
    const text = String(state || '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

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

  const OUTCOME_FIELD = 'terminationType';

  const TYPE_REF = 'name kind ofType { name kind ofType { name kind ofType { name kind } } }';

  const QUEUE_QUERY = 'query queue($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{aggregation{name value}}}}';

  const ALL_QUEUES_QUERY = 'query queues($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{lastQueue{name} aggregation{name value}}}}';

  const STATS_QUERY_HEAD = 'query stats($from:Long! $to:Long! $timeComparator:QueryTimeType $filter:TaskFilters $aggregations:[TaskV2Aggregation]){task(from:$from to:$to timeComparator:$timeComparator filter:$filter aggregations:$aggregations){tasks{lastQueue{name}';

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
    :host { --row: 28px; --rows: 5; --gap: 4px; }
    .list { display: flex; flex-direction: column; gap: var(--gap); overflow-y: auto;
            max-height: calc(var(--rows) * var(--row) + (var(--rows) - 1) * var(--gap) + 2px); }
    .card { display: flex; align-items: center; gap: 8px; flex: none; box-sizing: border-box; height: var(--row);
            background: var(--bg); border: 1px solid var(--line); border-left-width: 3px; border-radius: 5px; padding: 0 8px; }
    .name { flex: 1; min-width: 0; font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .detail { max-width: 45%; font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .time { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .none { font-size: 12px; color: var(--muted); padding: 4px 2px; }
    .available { border-left-color: var(--available); } .chip.available i { background: var(--available); }
    .onCall    { border-left-color: var(--onCall); }    .chip.onCall i    { background: var(--onCall); }
    .wrapup    { border-left-color: var(--wrapup); }    .chip.wrapup i    { background: var(--wrapup); }
    .idle      { border-left-color: var(--idle); }      .chip.idle i      { background: var(--idle); }
    .queues { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 10px; }
    :host { --qrows: 6; --qrow: 34px; }
    .tablewrap { overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px;
                 max-height: calc((var(--qrows) + 2) * var(--qrow)); }
    .qtable { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
    .qtable th, .qtable td { padding: 0 10px; height: var(--qrow); box-sizing: border-box; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
    .qtable th:first-child, .qtable td:first-child { text-align: left; }
    .qtable th { position: sticky; top: 0; z-index: 1; background: var(--bg); font-size: 11px; font-weight: 600; color: var(--muted); }
    .qtable td { font-variant-numeric: tabular-nums; }
    .qtable td.qn { font-weight: 600; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
    .qtable td.time { font-size: inherit; color: inherit; }
    .qtable tr.hot td { color: var(--onCall); }
    .qtable tfoot td { position: sticky; bottom: 0; z-index: 1; background: var(--bg); font-weight: 600; border-top: 2px solid var(--line); border-bottom: 0; }
    .debug { margin-top: 12px; font-size: 11px; }
    .debug pre { white-space: pre-wrap; background: var(--bg); border: 1px solid var(--line); padding: 8px; border-radius: 6px; }
    .notice { font-size: 12px; padding: 6px 8px; border-radius: 6px; margin-bottom: 10px; }
    .warn { background: #fdf3e0; color: #7a4a06; }
    .bad { background: #fbe7e7; color: #8a1c1c; }
    :host([dark]) .warn { background: #3a2f17; color: #eac27a; }
    :host([dark]) .bad { background: #3b1f1f; color: #f0a0a0; }
  `;

  class AgentDashboard extends HTMLElement {
    static get observedAttributes() {
      return ['token', 'org-id', 'data-center', 'base-url', 'channel', 'refresh-seconds',
              'stale-seconds', 'lookback-hours', 'darkmode', 'team-name', 'queues', 'agent-profile-id', 'rows', 'queue-rows', 'debug'];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="wrap"></div>`;
      this.root = this.shadowRoot.querySelector('.wrap');
      this.agents = [];
      this.queueStats = [];
      this.debug = {};
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

    fatal(message) {
      const err = new Error(message);
      err.fatal = true;
      return err;
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
        throw this.fatal(`Could not reach ${this.base} (data-center "${this.getAttribute('data-center') || ''}").`);
      }
      if (res.status === 401 || res.status === 403) {
        throw this.fatal('Your session does not allow this view, or it has expired. Sign in again.');
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

    async introspectIdleNames() {
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
        this.debug.introspection = found;
        return found;
      } catch (err) {
        if (err.fatal) throw err;
        this.debug.introspection = `not available (${err.message})`;
        return null;
      }
    }

    idleCandidates(found) {
      const names = ['idleCodeName', 'idleCode', 'idleCode{name}', 'idleCode{id name}', 'idleCodeId'];
      const list = [];
      if (found) {
        found.channel.forEach((sel) => list.push({ level: 'channel', sel }));
        found.session.forEach((sel) => list.push({ level: 'session', sel }));
      }
      ['channel', 'session'].forEach((level) => names.forEach((sel) => list.push({ level, sel })));
      const seen = new Set();
      return list.filter((c) => {
        const key = `${c.level}.${c.sel}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    async resolveIdleField(variables) {
      if (this.idleSel !== undefined) return this.idleSel;
      this.idleSel = null;
      const found = await this.introspectIdleNames();
      const tried = [];
      for (const cand of this.idleCandidates(found)) {
        try {
          await this.search(this.agentQuery(cand), variables);
          this.idleSel = cand;
          tried.push(`${cand.level}.${cand.sel}: accepted`);
          break;
        } catch (err) {
          if (err.fatal) throw err;
          tried.push(`${cand.level}.${cand.sel}: rejected`);
        }
      }
      this.debug.idleField = this.idleSel ? `${this.idleSel.level}.${this.idleSel.sel}` : 'none accepted';
      this.debug.idleTried = tried;
      return this.idleSel;
    }

    agentQuery(cand) {
      const top = ['agentId', 'agentName', 'teamName', 'startTime'];
      const channel = ['currentState', 'lastActivityTime'];
      if (cand) (cand.level === 'channel' ? channel : top).push(cand.sel);
      return `${AGENT_QUERY_HEAD}${top.join(' ')} channelInfo{${channel.join(' ')}}}}}`;
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

    reasonFrom(session, channel, cand, codeNames) {
      if (!cand) return '';
      const key = cand.sel.replace(/\{.*$/, '');
      const raw = (cand.level === 'channel' ? channel : session)[key];
      if (!raw) return '';
      if (typeof raw === 'object') return String(raw.name || codeNames[raw.id] || '');
      const text = String(raw);
      return codeNames[text] || (/^[0-9a-f-]{32,36}$/i.test(text) ? '' : text);
    }

    async loadAgents() {
      const now = Date.now();
      const variables = {
        from: `${now - this.lookbackMs}`, to: `${now}`,
        filter: { and: [{ isActive: { equals: true } }, { channelInfo: { channelType: { equals: this.channel } } }] },
        extFilter: {}, pagination: {},
      };
      const cand = await this.resolveIdleField(variables);
      const data = await this.search(this.agentQuery(cand), variables);
      const codeNames = cand ? await this.loadIdleCodeNames() : {};
      const team = (this.getAttribute('team-name') || '').trim().toLowerCase();
      return (data.agentSession.agentSessions || [])
        .map((s) => {
          const ch = (s.channelInfo && s.channelInfo[0]) || {};
          const group = groupFor(ch.currentState);
          return {
            id: s.agentId, name: s.agentName || 'Unknown', team: s.teamName || '',
            state: ch.currentState || '', group,
            reason: group === 'idle' ? this.reasonFrom(s, ch, cand, codeNames) : '',
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

    async loadAccess() {
      const profileId = (this.getAttribute('agent-profile-id') || '').trim();
      if (!profileId) return null;
      const now = Date.now();
      if (this.access !== undefined && this.accessFor === profileId && now - this.accessAt < QUEUE_LIST_TTL_MS) return this.access;
      let access = null;
      try {
        const res = await fetch(
          `${this.base}/organization/${this.orgId}/agent-profile/${profileId}`,
          { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } },
        );
        if (res.ok) {
          const body = await res.json();
          const view = body.viewableStatistics || {};
          access = {
            mode: String(view.accessQueueStats || '').toUpperCase(),
            queueIds: Array.isArray(view.contactServiceQueues) ? view.contactServiceQueues : [],
          };
        }
      } catch (err) {
        access = null;
      }
      this.access = access;
      this.accessFor = profileId;
      this.accessAt = access ? now : now - QUEUE_LIST_TTL_MS + 60000;
      return access;
    }

    async loadQueueStats() {
      const now = Date.now();
      if (this.statsRetryAt && now < this.statsRetryAt) return null;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const variables = {
        from: `${since.getTime()}`, to: `${now}`, timeComparator: 'createdTime',
        filter: {}, aggregations: [{ field: 'id', type: 'count', name: 'total' }],
      };
      const attempts = this.statsOutcome === undefined ? [OUTCOME_FIELD, ''] : [this.statsOutcome];
      let data = null;
      let outcome = '';
      for (const field of attempts) {
        try {
          data = await this.search(`${STATS_QUERY_HEAD}${field ? ` ${field}` : ''} aggregation{name value}}}}`, variables);
          outcome = field;
          this.statsOutcome = field;
          break;
        } catch (err) {
          if (err.fatal) throw err;
        }
      }
      if (!data) {
        this.statsRetryAt = now + 5 * 60 * 1000;
        this.debug.stats = 'rejected by the API';
        return null;
      }
      const stats = new Map();
      const outcomes = {};
      for (const row of data.task.tasks || []) {
        const name = (row.lastQueue && row.lastQueue.name) || '';
        if (!name) continue;
        const count = Number((row.aggregation || []).find((a) => a.name === 'total')?.value) || 0;
        const kind = outcome ? String(row[outcome] || '') : '';
        const entry = stats.get(name) || { offered: 0, handled: 0, abandoned: 0 };
        entry.offered += count;
        if (/abandon/i.test(kind)) entry.abandoned += count;
        else if (/normal/i.test(kind)) entry.handled += count;
        stats.set(name, entry);
        if (outcome) outcomes[kind || '(blank)'] = (outcomes[kind || '(blank)'] || 0) + count;
      }
      this.debug.stats = outcome ? `outcome field "${outcome}"` : 'counts only (no outcome field accepted)';
      this.debug.outcomesToday = outcomes;
      return { stats, outcome: Boolean(outcome) };
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
        const access = await this.loadAccess();
        this.queuesUnknown = !access;
        this.queuesHidden = Boolean(access && access.mode === 'NONE');
        if (this.queuesHidden || this.queuesUnknown) return [];
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
        if (!catalog) {
          this.queuesUnknown = true;
          return [];
        }
        const allowed = access.mode === 'ALL' ? catalog : catalog.filter((q) => access.queueIds.includes(q.id));
        const names = allowed.map((q) => q.name);
        const result = await this.loadQueueStats();
        const statsFor = (name) => (result
          ? { ...(result.stats.get(name) || { offered: 0, handled: 0, abandoned: 0 }), hasOutcome: result.outcome }
          : null);
        return names
          .map((name) => ({ name, ...(byName.get(name) || { waiting: 0, oldest: 0 }), stats: statsFor(name) }))
          .sort((a, b) => (b.waiting - a.waiting) || a.name.localeCompare(b.name));
      }

      this.queuesHidden = false;
      this.queuesUnknown = false;
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
        return { name, ...totals, stats: null };
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

    detailFor(agent, column) {
      if (column === 'onCall') return prettyState(agent.state);
      if (column === 'idle') return agent.reason;
      return '';
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
              <span class="name" title="${esc(a.name)}">${esc(a.name)}</span>
              ${this.detailFor(a, k) ? `<span class="detail">${esc(this.detailFor(a, k))}</span>` : ''}
              <span class="time" data-since="${a.since}">${clock(now - a.since)}</span>
            </div>`).join('') : '<div class="none">N/A</div>'}</div>
        </div>`).join('');

      const notice = this.error
        ? `<div class="notice warn">${esc(this.error)} Showing the last known data.</div>` : '';

      const cell = (value, ok) => (ok ? value : 'N/A');
      const rows = this.queueStats.map((q) => {
        const st = q.stats;
        const outcome = Boolean(st && st.hasOutcome);
        return `<tr class="${q.waiting ? 'hot' : ''}">
          <td class="qn" title="${esc(q.name)}">${esc(q.name)}</td>
          <td>${q.waiting}</td>
          <td class="time" ${q.waiting ? `data-since="${q.oldest}"` : ''}>${q.waiting ? clock(now - q.oldest) : '--:--'}</td>
          <td>${cell(st ? st.offered : 0, Boolean(st))}</td>
          <td>${cell(st ? st.handled : 0, outcome)}</td>
          <td>${cell(st ? st.abandoned : 0, outcome)}</td>
        </tr>`;
      }).join('');
      const sum = (key) => this.queueStats.reduce((n, q) => n + (q.stats ? q.stats[key] : 0), 0);
      const known = this.queueStats.length > 0 && this.queueStats.every((q) => q.stats);
      const outcomeKnown = known && this.queueStats.every((q) => q.stats.hasOutcome);
      const oldest = this.queueStats.filter((q) => q.waiting).reduce((m, q) => (m && m < q.oldest ? m : q.oldest), 0);
      const totals = this.queueStats.length > 1 ? `<tfoot><tr>
          <td class="qn">Total</td>
          <td>${this.queueStats.reduce((n, q) => n + q.waiting, 0)}</td>
          <td class="time" ${oldest ? `data-since="${oldest}"` : ''}>${oldest ? clock(now - oldest) : '--:--'}</td>
          <td>${cell(sum('offered'), known)}</td>
          <td>${cell(sum('handled'), outcomeKnown)}</td>
          <td>${cell(sum('abandoned'), outcomeKnown)}</td>
        </tr></tfoot>` : '';
      const table = this.queueStats.length
        ? `<div class="tablewrap"><table class="qtable">
            <thead><tr><th>Queue</th><th>Waiting</th><th>Longest wait</th><th>Offered</th><th>Handled</th><th>Abandoned</th></tr></thead>
            <tbody>${rows}</tbody>${totals}</table></div>`
        : '<div class="none">N/A</div>';
      let queues = `<div class="queues">${table}</div>`;
      if (this.queuesHidden) queues = '';
      else if (this.queuesUnknown) queues = '<div class="queues"><div class="none">Queue access could not be determined. Check the agent-profile-id setting.</div></div>';
      const debug = this.hasAttribute('debug')
        ? `<details class="debug" open><summary>Debug</summary><pre>${esc(JSON.stringify(this.debug, null, 2))}</pre></details>` : '';

      this.style.setProperty('--rows', String(Math.floor(positive(this.getAttribute('rows'), DEFAULTS.visibleRows))));
      this.style.setProperty('--qrows', String(Math.floor(positive(this.getAttribute('queue-rows'), DEFAULTS.queueRows))));
      const scrolled = [...this.shadowRoot.querySelectorAll('.list, .tablewrap')].map((el) => el.scrollTop);
      this.root.innerHTML = `${notice}<div class="summary">${chips}</div><div class="board">${cols}</div>${queues}${debug}`;
      this.shadowRoot.querySelectorAll('.list, .tablewrap').forEach((el, i) => { if (scrolled[i]) el.scrollTop = scrolled[i]; });
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
