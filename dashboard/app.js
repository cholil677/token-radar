// Token Radar dashboard. Reads window.RADAR (data.js, written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// view with the model's own inputs and farm plan, and a model sandbox. No network:
// every byte shown is in data.js. The page recomputes each row from the snapshot
// figures, so the code and board.json visibly agree.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, strictOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }

  // The model, in one function: the same arithmetic lib/model.ts runs. The sandbox
  // calls it with changed constants; the detail view calls it to check board.json.
  function scoreRow(row, m) {
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var mat = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var br = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_extra) * m.breadth_step;
    return { value: Math.max(1, Math.round(row.tvl_usd * m.base_multiple * gm * mat * br)), gm: gm, mat: mat, br: br };
  }

  // The farm plan, derived in the page from the same rules as board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost.
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 1e7) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function actionFor(p, cap, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + cap + ' of USDC on ' + n + ' (' + chain + ') and leave the loan open';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity') >= 0) return 'Add $' + cap + ' of liquidity to ' + n + "'s deepest pool on " + chain + ' and hold the LP position';
    if (c.indexOf('bridge') >= 0) return 'Move $' + cap + ' of USDC to ' + chain + ' through ' + n + ', then put the bridged funds to work in its app';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + cap + " of the chain's native staking asset through " + n + ' and keep the receipt token';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + cap + ' of USDC as margin on ' + n + ' and open a single small hedged position';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + cap + " into " + n + "'s highest-TVL vault on " + chain + ' and leave it compounding';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + cap + " of " + n + "'s yield-bearing asset on " + chain + ' and hold it';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + chain;
    if (c.indexOf('insurance') >= 0) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + chain + ' and keep the policy active';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Allocate $' + cap + ' to a ' + n + ' vault on ' + chain + ' and keep the vault shares';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + cap + ' on ' + n + ' and take one position in an open market';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open';
  }
  function farmSteps(p) {
    var chain = chainOf(p), cap = capitalFor(p), hold = holdFor(p.age_days);
    var steps = [
      { text: 'Open a fresh wallet for this farm only and store its seed phrase offline, never in a screenshot or a chat', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, cap, chain), cost: '$' + cap + ' of capital and about $' + (cap >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Do a second, different qualifying action — a swap, a borrow, a vote or a deposit — so the wallet shows more than one interaction', cost: 'about $2 of gas', time: '10 minutes' },
      { text: 'Repeat one qualifying action every week while the position is open', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days so it is counted in more than one snapshot', cost: 'the $' + cap + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's own points or rewards page before withdrawing, and claim only from a link the protocol itself publishes", cost: 'free to check; never pay to claim', time: '10 minutes' },
      { text: 'Record the wallet, the dates and every transaction in a farm log, then plan the exit: withdraw in two steps and leave a little gas behind', cost: 'nothing but the log', time: '5 minutes' }
    ];
    return steps.map(function (s) {
      var out = s.text + ' (Cost: ' + s.cost + '; time: ' + s.time + '.)';
      if (out.length > 600) out = out.slice(0, 596) + '...';
      return out;
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var ps = new URLSearchParams(h);
    if (ps.get('q')) state.q = ps.get('q');
    if (ps.get('p')) state.selected = ps.get('p');
    if (ps.get('category')) state.category = ps.get('category');
    if (ps.get('chain')) state.chain = ps.get('chain');
    if (ps.get('tab')) state.tab = ps.get('tab');
  }
  function writeHash() {
    var ps = new URLSearchParams();
    if (state.q) ps.set('q', state.q);
    if (state.category !== 'all') ps.set('category', state.category);
    if (state.chain !== 'all') ps.set('chain', state.chain);
    if (state.selected) ps.set('p', state.selected);
    if (state.tab !== 'pre-token') ps.set('tab', state.tab);
    var next = ps.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function isWatchlisted(r) { return !!r.watchlist; }
  function model() { return state.sandbox || DATA.model; }
  function valueOf(r) { return state.sandbox ? scoreRow(r, state.sandbox).value : r.implied_value_usd; }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.watchOnly && !isWatchlisted(r)) return false;
      if (state.strictOnly && !r.strict_definition) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = valueOf(a); bv = valueOf(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('i', null), 'TOKEN RADAR'),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      el('p', { class: 'sub', text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor (' + DATA.extended_size + ' of them extended — they record no token, but their category marks a possible wrapped or staked product). Implied value is a model, not a promise.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var wOnly = el('input', { type: 'checkbox', id: 'wonly', checked: state.watchOnly ? 'checked' : null });
    wOnly.addEventListener('change', function () { state.watchOnly = wOnly.checked; render(); });
    var sOnly = el('input', { type: 'checkbox', id: 'sonly', checked: state.strictOnly ? 'checked' : null });
    sOnly.addEventListener('change', function () { state.strictOnly = sOnly.checked; render(); });
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort by' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: o[0] === state.sort ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sort),
      el('div', { class: 'checks' },
        el('label', null, wOnly, 'Watchlist only'),
        el('label', null, sOnly, 'Strict definition only')
      ),
      el('div', { class: 'tabs' }, pre, live),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }
  function sortHead(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }
  function tagFor(r) {
    if (isWatchlisted(r)) return el('span', { class: 'tag tag-watch', text: 'WATCHLIST' });
    if (!r.strict_definition) return el('span', { class: 'tag tag-ext', text: 'EXTENDED' });
    return null;
  }
  function boardTable() {
    var list = sortedRows(visibleRows());
    if (!list.length) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { class: 'sub', text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.strictOnly = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return valueOf(r); })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), tagFor(r)),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: g }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((valueOf(r) / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(valueOf(r)) })
        )),
        el('td', null, el('span', { class: 'sub', text: 'no token' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' + (state.sandbox ? ' Sandbox on: values recomputed with your constants.' : '') }),
          el('thead', null, el('tr', null,
            sortHead('implied', 'Rank'), sortHead('name', 'Protocol'), sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'), sortHead('age', 'Age'), sortHead('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }
  function modelPanel() {
    var m = DATA.model;
    var f = 'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.breadth_max_extra + ') x ' + m.breadth_step + ') )';
    var panel = el('section', { class: 'panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row. No protocol name is special-cased, and no row is hand-picked. Age is the time since the protocol was first listed — the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Seven-day growth is clamped, because a single week of +4,448% is noise, not value.' }),
      el('div', { class: 'formula', text: f })
    );
    var sb = state.sandbox || { base_multiple: m.base_multiple, growth_weight: m.growth_weight, maturity_range: m.maturity_range };
    function slider(id, label, min, max, step, val, on) {
      var out = el('output', { text: String(val) });
      var inp = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(val), 'aria-label': label });
      inp.addEventListener('input', function () { out.textContent = inp.value; on(parseFloat(inp.value)); });
      return el('div', null, el('label', { for: id, text: label + ' ' }, out), inp);
    }
    function setSandbox(patch) {
      var cur = state.sandbox || { base_multiple: m.base_multiple, growth_weight: m.growth_weight, maturity_range: m.maturity_range };
      state.sandbox = {
        base_multiple: patch.base !== undefined ? patch.base : cur.base_multiple,
        growth_weight: patch.growth !== undefined ? patch.growth : cur.growth_weight,
        growth_floor: m.growth_floor, growth_cap: m.growth_cap,
        maturity_floor: m.maturity_floor, maturity_range: patch.mat !== undefined ? patch.mat : cur.maturity_range,
        maturity_days: m.maturity_days, unknown_age_days: m.unknown_age_days,
        breadth_step: m.breadth_step, breadth_max_extra: m.breadth_max_extra
      };
      render();
    }
    panel.appendChild(el('h3', { text: 'Model sandbox — change the constants, watch the board move' }));
    panel.appendChild(el('div', { class: 'sandbox' },
      slider('sb-base', 'Base multiple', 0.05, 0.5, 0.01, sb.base_multiple, function (v) { setSandbox({ base: v }); }),
      slider('sb-growth', 'Growth weight', 0, 1, 0.05, sb.growth_weight, function (v) { setSandbox({ growth: v }); }),
      slider('sb-mat', 'Maturity range', 0, 1, 0.05, sb.maturity_range, function (v) { setSandbox({ mat: v }); })
    ));
    panel.appendChild(el('p', { class: 'sub', text: state.sandbox ? 'Sandbox on: the table above uses your constants. board.json keeps the model as submitted.' : 'The sandbox changes nothing in board.json — it only shows how the ranking answers to the constants.' }));
    if (state.sandbox) panel.appendChild(el('button', { class: 'button', type: 'button', text: 'Reset the sandbox', onclick: function () { state.sandbox = null; render(); } }));
    return panel;
  }
  function detailPanel() {
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (!row) return null;
    var check = scoreRow(row, DATA.model);
    var steps = farmSteps(row);
    var sec = el('section', { class: 'panel detail', id: 'detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
        ),
        el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { state.selected = null; writeHash(); render(); } })
      ),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Recomputed in this page' }), el('b', { class: 'num', text: fmtUsd(check.value) })),
        el('div', null, el('span', { text: 'Token record' }), el('b', { class: 'num', text: row.strict_definition ? 'no token, strict' : 'no token, extended' }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(check.value) + (check.value === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. "No token" means the snapshot records none — it is not proof the protocol has none.' }),
      !row.strict_definition ? el('p', { class: 'note', text: 'Extended row: this protocol records no token, but its category marks it as a possible wrapped, staked or bridged product of a token that already trades. It is ranked because it records no token — not because the radar claims it will launch one.' }) : null,
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' (Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 2, -1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    );
    return sec;
  }
  function footer() {
    return el('p', { class: 'foot', text: 'Method: the board ranks protocols that record no token by implied value = TVL x base multiple x growth multiplier x maturity multiplier x chain-breadth multiplier. The watchlist (TVL at least $50M, no token on record) is the floor; 160 early rows below it complete the board. Live-token protocols are set aside with their market caps. Implied value is this entry\u2019s own claim, not a price and not a prediction that a token will be issued.' });
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    var d = state.tab === 'pre-token' ? detailPanel() : null;
    if (d) shell.appendChild(d);
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (d) {
      var node = document.getElementById('detail');
      if (node) node.scrollIntoView({ block: 'nearest' });
    }
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });
  // Test hook for local verification only: lets a script compare the page's own
  // farm plans and scores against board.json. Not used by the page itself.
  window.__RADAR_TEST__ = { farmSteps: farmSteps, scoreRow: scoreRow, visibleRows: visibleRows };
})();
