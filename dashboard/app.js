// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a sortable and filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, the calibrated sector table, and a sandbox that re-ranks the
// board from the same figures. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: false };
  var weights = { growth: DATA.model.growth_weight, maturity: DATA.model.maturity_range };
  var board = document.getElementById('board');
  var dialog = document.getElementById('detail');

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function, the same arithmetic lib/model.ts scores with: the page recomputes a
  // row from the snapshot figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same model. The sandbox varies only the two weights.
  function impliedOf(row, w) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * w.growth;
    var maturity = row.age_days === null || row.age_days === undefined
      ? m.unknown_age_multiplier
      : m.maturity_floor + (Math.min(Math.max(row.age_days, 0), m.maturity_days) / m.maturity_days) * w.maturity;
    return Math.max(1, Math.round(row.tvl_usd * row.sector_multiple * growthMult * maturity));
  }
  function defaultWeights() { return { growth: DATA.model.growth_weight, maturity: DATA.model.maturity_range }; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // The rows the table shows: the submitted ranking, or the sandbox's recomputed one.
  function viewRows() {
    if (!state.sandbox) return DATA.rows;
    var w = weights;
    var rescored = DATA.rows.map(function (r) {
      var copy = {};
      Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      copy.implied_value_usd = impliedOf(r, w);
      return copy;
    });
    rescored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    rescored.forEach(function (r, i) { r.rank = i + 1; });
    return rescored;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return viewRows().filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
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
      else if (key === 'sector') { av = a.sector_multiple; bv = b.sector_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    document.getElementById('count').textContent = list.length + ' rows shown' + (state.sandbox ? ' — sandbox ranking' : '');
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; document.getElementById('q').value = ''; document.getElementById('category').value = 'all'; document.getElementById('chain').value = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), WATCH[r.slug] ? el('span', { class: 'watch', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.sector_multiple.toFixed(2) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('sector', 'Sector x'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    document.getElementById('count').textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '0' },
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are what calibrate the sector multiples.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row, defaultWeights());
    var steps = row.farm_steps || [];
    var chains = row.chains && row.chains.length ? row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' +' + (row.chains.length - 4) + ' more' : '') : 'an unnamed chain';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' — watchlist' : ' — early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chains })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Sector multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: row.sector_multiple.toFixed(2) + 'x · ' + row.sector_live_count + ' live' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → ' + row.growth_multiplier.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → ' + row.maturity_multiplier.toFixed(2) + 'x' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function fillStatic() {
    document.getElementById('meta-date').textContent = 'Snapshot ' + DATA.as_of;
    document.getElementById('meta-model').textContent = DATA.model_version + ' model';
    document.getElementById('fact-watchlist').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    document.getElementById('fact-board').textContent = String(DATA.board_size);
    document.getElementById('fact-early').textContent = String(DATA.early_size);
    document.getElementById('fact-live').textContent = String(DATA.live_size);
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var cat = document.getElementById('category');
    cat.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { cat.appendChild(el('option', { value: c, text: c })); });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var ch = document.getElementById('chain');
    ch.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { ch.appendChild(el('option', { value: c, text: c })); });
    var tbody = document.querySelector('#sectors tbody');
    (DATA.sectors || []).forEach(function (s) {
      tbody.appendChild(el('tr', null,
        el('td', { text: s.category }),
        el('td', { class: 'num', text: s.multiple.toFixed(2) + 'x' }),
        el('td', { class: 'num', text: String(s.live_count) })
      ));
    });
  }

  function wireControls() {
    var q = document.getElementById('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    var cat = document.getElementById('category');
    cat.value = state.category;
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = document.getElementById('chain');
    ch.value = state.chain;
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var pre = document.getElementById('tab-pre');
    var live = document.getElementById('tab-live');
    function setTab(tab) {
      state.tab = tab;
      pre.setAttribute('aria-pressed', tab === 'pre-token' ? 'true' : 'false');
      live.setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
      writeHash(); render();
    }
    pre.addEventListener('click', function () { setTab('pre-token'); });
    live.addEventListener('click', function () { setTab('live'); });
    setTab(state.tab);
    var gw = document.getElementById('w-growth');
    var mw = document.getElementById('w-maturity');
    var note = document.getElementById('w-note');
    function applySandbox() {
      weights = { growth: parseFloat(gw.value), maturity: parseFloat(mw.value) };
      document.getElementById('w-growth-out').textContent = weights.growth.toFixed(2);
      document.getElementById('w-maturity-out').textContent = weights.maturity.toFixed(2);
      state.sandbox = weights.growth !== DATA.model.growth_weight || weights.maturity !== DATA.model.maturity_range;
      note.textContent = state.sandbox ? 'Sandbox ranking — move the sliders back or reset to return to the submitted board.' : 'Showing the submitted ranking.';
      render();
    }
    gw.addEventListener('input', applySandbox);
    mw.addEventListener('input', applySandbox);
    document.getElementById('w-reset').addEventListener('click', function () {
      gw.value = DATA.model.growth_weight; mw.value = DATA.model.maturity_range; applySandbox();
    });
  }

  function render() {
    board.textContent = '';
    board.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    board.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });

  readHash();
  fillStatic();
  wireControls();
  render();
})();
