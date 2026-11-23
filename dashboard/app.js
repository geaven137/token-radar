// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a sortable and filterable table, a per-protocol detail view with the fitted
// model's own breakdown and the protocol's farm plan, the live-token set, the full 758-protocol
// ledger, the fit's held-out evidence, and a sandbox that re-prices the farm verdicts from the same
// figures. No network: every byte it shows is in data.js.
//
// The page also verifies the board: it recomputes all 200 rows from the fitted coefficients in
// DATA.recompute — the same arithmetic lib/model.ts scores with — and checks the ranks, the
// watchlist coverage and the ledger totals before it calls the board sound.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var RANKS = {};
  DATA.rows.forEach(function (r) { RANKS[r.slug] = r.rank; });
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', group: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: false };
  var econ = { share: DATA.model.airdrop_share, scale: 1 };
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
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
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
  function fmtMiss(logErr) { return '×' + Math.exp(logErr).toFixed(2); }
  function round2(n) { return Math.round(n * 100) / 100; }

  // The fitted model in one function, the same arithmetic lib/model.ts scores with. Coefficients
  // arrive in order: intercept, then the kept terms in logTvl, logTvl^2, growth, logAge,
  // logChains, recent order, then one dummy per category. The odds come from the age buckets;
  // unknown age takes the global.
  function recompute(row) {
    var R = DATA.recompute;
    var M = DATA.model;
    var terms = R.terms;
    var lt = Math.log(row.tvl_usd) - R.mean_log_tvl;
    var age = row.age_days === null || row.age_days === undefined ? R.median_age_days : row.age_days;
    var pred = R.coefficients[0];
    var k = 1;
    var parts = [{ label: 'Intercept', value: R.coefficients[0] }];
    if (terms.indexOf('logTvl') >= 0) { pred += R.coefficients[k] * lt; parts.push({ label: 'Size (log TVL)', value: R.coefficients[k] * lt }); k++; }
    if (terms.indexOf('logTvl2') >= 0) { pred += R.coefficients[k] * lt * lt; parts.push({ label: 'Size squared', value: R.coefficients[k] * lt * lt }); k++; }
    if (terms.indexOf('growth') >= 0) {
      var g = Math.min(100, Math.max(-50, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d)) / 100;
      pred += R.coefficients[k] * g; parts.push({ label: 'Seven-day growth', value: R.coefficients[k] * g }); k++;
    }
    if (terms.indexOf('logAge') >= 0) {
      var la = Math.log(age + 1) - R.mean_log_age;
      pred += R.coefficients[k] * la; parts.push({ label: 'Age (log days)', value: R.coefficients[k] * la }); k++;
    }
    if (terms.indexOf('logChains') >= 0) {
      var lc = Math.log((row.chains || []).length) - R.mean_log_chains;
      pred += R.coefficients[k] * lc; parts.push({ label: 'Chains (log count)', value: R.coefficients[k] * lc }); k++;
    }
    if (terms.indexOf('recent') >= 0) {
      var rc = age < 365 ? 1 : 0;
      pred += R.coefficients[k] * rc; parts.push({ label: 'Listed in the last year', value: R.coefficients[k] * rc }); k++;
    }
    if (terms.indexOf('cats') >= 0) {
      for (var i = 0; i < R.categories.length; i++) {
        if ((row.category || 'Other') === R.categories[i]) { pred += R.coefficients[k]; parts.push({ label: 'Category: ' + R.categories[i], value: R.coefficients[k] }); }
        k++;
      }
    }
    var multiple = Math.min(M.multiple_cap, Math.max(M.multiple_floor, Math.exp(pred)));
    var odds = R.odds_global;
    if (row.age_days !== null && row.age_days !== undefined) {
      for (var b = 0; b < R.odds_buckets.length; b++) {
        if (row.age_days >= R.odds_buckets[b].lo && row.age_days < R.odds_buckets[b].hi) { odds = R.odds_buckets[b].odds; break; }
      }
    }
    var ifLaunches = Math.max(1, Math.round(row.tvl_usd * multiple));
    var implied = Math.max(1, Math.round(row.tvl_usd * multiple * odds));
    return {
      parts: parts, pred: pred, multiple: multiple, odds: odds, ifLaunches: ifLaunches, implied: implied,
      p25: Math.max(1, Math.round(implied * Math.exp(R.q25_log))),
      p75: Math.max(1, Math.round(implied * Math.exp(R.q75_log)))
    };
  }

  // One farm position's economics at a given airdrop share and farmer-count scale — the same
  // arithmetic as farmEconomics in lib/model.ts, priced on the P25 value. The submitted verdicts
  // are the 5% share at 1x scale; the sandbox varies only those two assumptions.
  function verdictOf(row, share, scale) {
    var M = DATA.model;
    var ev = round2((row.implied_value_p25_usd * share) / (row.farm_farmers * scale));
    var net = round2(ev - row.farm_fees_usd);
    var perHour = round2(net / row.farm_hours);
    var v = net >= M.verdict_net_min && perHour >= M.verdict_hourly_min ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
    return { ev: ev, net: net, perHour: perHour, verdict: v };
  }
  function viewVerdict(row) {
    if (!state.sandbox) return { ev: null, net: row.farm_net_usd, perHour: row.farm_usd_per_hour, verdict: row.verdict };
    return verdictOf(row, econ.share, econ.scale);
  }

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
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('group')) state.group = params.get('group');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.group !== 'all') params.set('group', state.group);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // The integrity strip: recompute every row and check the board's own guarantees.
  function verify() {
    var strip = document.getElementById('integrity');
    var ok = 0;
    var bad = [];
    DATA.rows.forEach(function (r) {
      var c = recompute(r);
      var close = Math.abs(c.implied - r.implied_value_usd) / r.implied_value_usd < 0.001
        && Math.abs(c.p25 - r.implied_value_p25_usd) / r.implied_value_p25_usd < 0.001
        && Math.abs(c.p75 - r.implied_value_p75_usd) / r.implied_value_p75_usd < 0.001
        && Math.abs(c.odds - r.token_odds) < 1e-9;
      if (close) ok++; else bad.push(r.slug);
    });
    var sorted = DATA.rows.every(function (r, i) { return i === 0 || r.implied_value_usd <= DATA.rows[i - 1].implied_value_usd; });
    var ranks = DATA.rows.every(function (r, i) { return r.rank === i + 1; });
    var watch = DATA.watchlist.every(function (s) { return WATCH[s] && RANKS[s] !== undefined; });
    var lc = DATA.ledger_counts;
    var total = DATA.ledger.length;
    var ledgerOk = lc.ranked + lc.has_token + lc.not_ranked === total && lc.ranked === DATA.board_size;
    var pass = ok === DATA.rows.length && sorted && ranks && watch && ledgerOk;
    strip.className = 'integrity ' + (pass ? 'pass' : 'fail');
    strip.textContent = pass
      ? 'Board verified in this page: ' + ok + '/' + DATA.rows.length + ' rows recompute within 0.1%, ranks 1–' + DATA.board_size + ' in order, watchlist ' + DATA.watchlist_size + '/' + DATA.watchlist_size + ', ledger ' + total + ' = ' + lc.ranked + ' ranked + ' + lc.has_token + ' with a token + ' + lc.not_ranked + ' not ranked.'
      : 'Board check failed: ' + ok + '/' + DATA.rows.length + ' rows recompute' + (bad.length ? ' — ' + bad.slice(0, 3).join(', ') : '') + '. Ranks sorted: ' + sorted + '. Watchlist covered: ' + watch + '. Ledger adds up: ' + ledgerOk + '.';
  }

  function matchesCommon(r) {
    var q = state.q.trim().toLowerCase();
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (!q) return true;
    return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function rows() {
    return DATA.rows.filter(function (r) {
      if (!matchesCommon(r)) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && viewVerdict(r).verdict !== state.verdict) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var order = { FARM: 0, MARGINAL: 1, SKIP: 2 };
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'iflaunches') { av = a.if_launches_value_usd; bv = b.if_launches_value_usd; }
      else if (key === 'verdict') { av = order[viewVerdict(a).verdict]; bv = order[viewVerdict(b).verdict]; }
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

  function verdictBadge(v, net, perHour) {
    return el('div', { class: 'verdict-cell' },
      el('span', { class: 'badge ' + v.toLowerCase(), text: v }),
      el('span', { class: 'sub', text: 'net ' + fmtSigned(net) + ' · ' + fmtSigned(perHour) + '/h' })
    );
  }

  function emptyPanel(text) {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: text }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.group = 'all';
        document.getElementById('q').value = ''; document.getElementById('category').value = 'all';
        document.getElementById('chain').value = 'all'; document.getElementById('verdict').value = 'all';
        document.getElementById('group').value = 'all'; writeHash(); render();
      } })
    ));
  }

  function boardTable() {
    var list = sortedRows(rows());
    var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[viewVerdict(r).verdict]++; });
    document.getElementById('count').textContent = list.length + ' rows shown · FARM ' + counts.FARM + ' / MARGINAL ' + counts.MARGINAL + ' / SKIP ' + counts.SKIP + (state.sandbox ? ' — sandbox verdicts' : '');
    if (list.length === 0) return emptyPanel('Clear the search or pick another category, chain or verdict to see the board again.');
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var v = viewVerdict(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), WATCH[r.slug] ? el('span', { class: 'watch', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ' · ' + fmtAge(r.age_days) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('div', { class: 'odds' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.round(r.token_odds * 100) + '%' })),
          el('span', { class: 'num', text: (r.token_odds * 100).toFixed(1) + '%' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.if_launches_value_usd) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('div', { class: 'implied-num' },
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
            el('span', { class: 'sub', text: fmtUsd(r.implied_value_p25_usd) + ' – ' + fmtUsd(r.implied_value_p75_usd) })
          )
        )),
        el('td', null, verdictBadge(v.verdict, v.net, v.perHour))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Implied is TVL × fitted multiple × token odds; the range is the fit’s own P25–P75 miss. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('odds', 'Token odds'),
            sortHeader('iflaunches', 'If it launches'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Verdict')
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
        el('td', { class: 'num', text: r.mcap_usd !== null && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are what the regression fits on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function ledgerTable() {
    var list = DATA.ledger.filter(function (e) {
      if (state.group !== 'all' && e.group !== state.group) return false;
      return matchesCommon(e);
    }).sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    document.getElementById('count').textContent = list.length + ' of ' + DATA.ledger.length + ' protocols in the ledger';
    if (list.length === 0) return emptyPanel('Clear the search or pick another category or group to see the ledger again.');
    var labels = { ranked: 'Ranked', 'has-token': 'Has a token', 'not-ranked': 'Not ranked' };
    var tbody = el('tbody');
    list.forEach(function (e) {
      var detail = e.group === 'ranked' ? 'Rank ' + RANKS[e.slug] + ' on the board'
        : e.group === 'has-token' ? 'Records a token — market cap is a fact, not a model'
        : e.reason || 'Not ranked';
      var tr = el('tr', { tabindex: '0' },
        el('td', null, el('div', { class: 'name' }, el('b', { text: e.name }), el('span', { class: 'sub', text: e.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(e.tvl_usd) }),
        el('td', null, el('span', { class: 'badge ' + (e.group === 'ranked' ? 'farm' : e.group === 'has-token' ? 'marginal' : 'skip'), text: labels[e.group] })),
        el('td', { class: 'sub', text: detail })
      );
      if (e.group === 'ranked') {
        tr.addEventListener('click', function () { openDetail(e.slug); });
        tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(e.slug); } });
      } else {
        tr.style.cursor = 'default';
      }
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Every protocol in the snapshot, in exactly one group: ranked on the board, already recording a token, or pre-token and not ranked — with the reason. Select a ranked row for its model breakdown.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Group' }), el('th', { scope: 'col', text: 'Detail' }))),
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
    var c = recompute(row);
    var v = viewVerdict(row);
    var steps = row.farm_steps || [];
    var chains = row.chains && row.chains.length ? row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' +' + (row.chains.length - 4) + ' more' : '') : 'an unnamed chain';
    var bucket = 'global share (age unknown)';
    if (row.age_days !== null && row.age_days !== undefined) {
      DATA.odds.buckets.forEach(function (b) { if (row.token_odds === b.odds) bucket = b.label; });
    }
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' — watchlist' : ' — early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chains + ' · listed ' + fmtAge(row.age_days) })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted multiple' }), el('b', { class: 'num', text: row.fitted_multiple.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: 'Token odds (' + bucket + ')' }), el('b', { class: 'num', text: (row.token_odds * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'If it launches a token' }), el('b', { class: 'num', text: fmtUsd(row.if_launches_value_usd) })),
        el('div', null, el('span', { text: 'P25–P75 range' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_p25_usd) + ' – ' + fmtUsd(row.implied_value_p75_usd) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Fitted log multiple ' + c.pred.toFixed(3) + ': ' + c.parts.map(function (p) { return p.label + ' ' + (p.value >= 0 ? '+' : '') + p.value.toFixed(3); }).join(', ') + '. Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(c.implied) + (Math.abs(c.implied - row.implied_value_usd) / row.implied_value_usd < 0.001 ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict — ' + v.verdict }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Priced on the P25 value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_p25_usd) })),
        el('div', null, el('span', { text: 'Airdrop pool (' + Math.round((state.sandbox ? econ.share : DATA.model.airdrop_share) * 100) + '%)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_p25_usd * (state.sandbox ? econ.share : DATA.model.airdrop_share)) })),
        el('div', null, el('span', { text: 'Estimated farmers' }), el('b', { class: 'num', text: Math.round(row.farm_farmers * (state.sandbox ? econ.scale : 1)).toLocaleString('en-US') })),
        el('div', null, el('span', { text: 'Expected share' }), el('b', { class: 'num', text: fmtSigned(v.ev === null ? row.farm_net_usd + row.farm_fees_usd : v.ev) })),
        el('div', null, el('span', { text: 'Gas and fees (' + row.farm_hours + 'h)' }), el('b', { class: 'num', text: fmtSigned(row.farm_fees_usd) })),
        el('div', { class: 'total' }, el('span', { text: 'Net' }), el('b', { class: 'num', text: fmtSigned(v.net) + ' · ' + fmtSigned(v.perHour) + '/h' }))
      ),
      el('p', { class: 'sub', text: 'FARM needs a net of at least $25 and $5 an hour on the downside value; MARGINAL needs a net of at least $0. The farmer count is a rough proxy (TVL ÷ $10,000, clamped 1,000–100,000) — the sandbox in the model panel shows how the verdict moves if it is wrong.' + (state.sandbox ? ' These are the sandbox figures.' : '') })
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
    var fit = DATA.fit;
    document.getElementById('kpi-loo').textContent = fmtMiss(fit.loo_median);
    document.getElementById('kpi-wf').textContent = fmtMiss(fit.wf_median);
    document.getElementById('kpi-range').textContent = (fit.range_honesty * 100).toFixed(1) + '%';
    document.getElementById('kpi-brier').textContent = DATA.odds.brier.toFixed(3) + ' vs ' + DATA.odds.brier_base.toFixed(3);
    document.getElementById('kpi-terms').textContent = fit.terms.length + ' of 7';
    document.getElementById('kpi-farm').textContent = DATA.verdicts.farm + ' of ' + DATA.board_size;
    document.getElementById('kpi-watch').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    var lc = DATA.ledger_counts;
    var total = DATA.ledger.length;
    document.getElementById('acct-total').textContent = String(total);
    document.getElementById('acct-ranked').textContent = String(lc.ranked);
    document.getElementById('acct-token').textContent = String(lc.has_token);
    document.getElementById('acct-out').textContent = String(lc.not_ranked);
    var segs = document.querySelectorAll('#acct-bar .seg');
    segs[0].style.width = (lc.ranked / total * 100).toFixed(1) + '%';
    segs[1].style.width = (lc.has_token / total * 100).toFixed(1) + '%';
    segs[2].style.width = (lc.not_ranked / total * 100).toFixed(1) + '%';
    var categories = Array.from(new Set(DATA.ledger.map(function (e) { return e.category || 'Other'; }))).sort();
    var cat = document.getElementById('category');
    cat.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { cat.appendChild(el('option', { value: c, text: c })); });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var ch = document.getElementById('chain');
    ch.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { ch.appendChild(el('option', { value: c, text: c })); });
    var val = document.querySelector('#validation tbody');
    val.appendChild(el('tr', null,
      el('td', { text: 'Leave-one-out' }),
      el('td', { class: 'num', text: fmtMiss(fit.loo_median) }),
      el('td', { class: 'num', text: fmtMiss(fit.loo_mean) }),
      el('td', { class: 'num', text: fmtMiss(fit.loo_flat_median) }),
      el('td', { class: 'num', text: String(fit.training_n) })
    ));
    val.appendChild(el('tr', null,
      el('td', { text: 'Walk-forward (oldest 70% → newest 30%)' }),
      el('td', { class: 'num', text: fmtMiss(fit.wf_median) }),
      el('td', { class: 'num', text: fmtMiss(fit.wf_mean) }),
      el('td', { class: 'num', text: fmtMiss(fit.wf_flat_median) }),
      el('td', { class: 'num', text: fit.wf_train_n + ' fit / ' + fit.wf_test_n + ' tested' })
    ));
    val.appendChild(el('tr', null,
      el('td', { text: 'P25–P75 range honesty' }),
      el('td', { class: 'num', text: (fit.range_honesty * 100).toFixed(1) + '% inside' }),
      el('td', { class: 'num', text: 'target 50%' }),
      el('td', { class: 'num', text: '—' }),
      el('td', { class: 'num', text: String(fit.training_n) })
    ));
    var tt = document.querySelector('#terms tbody');
    fit.term_table.forEach(function (t) {
      tt.appendChild(el('tr', null,
        el('td', { text: t.term }),
        el('td', { class: 'num', text: fmtMiss(t.loo_with_median) }),
        el('td', { class: 'num', text: fmtMiss(t.loo_without_median) }),
        el('td', { class: 'num', text: fmtMiss(t.loo_with_mean) }),
        el('td', { class: 'num', text: fmtMiss(t.loo_without_mean) }),
        el('td', { class: 'num', text: fmtMiss(t.wf_with_median) }),
        el('td', { class: 'num', text: fmtMiss(t.wf_without_median) }),
        el('td', null, el('span', { class: 'badge ' + (t.kept ? 'farm' : 'skip'), text: t.kept ? 'Kept' : 'Dropped' }))
      ));
    });
    var meanings = {
      intercept: 'Baseline log multiple at mean size and age',
      logTvl: 'Per e-fold of TVL above the mean — the size curve',
      'logTvl^2': 'Curvature in the size effect',
      growth: 'Per unit of clamped 7-day growth',
      logAge: 'Per e-fold of age above the mean',
      logChains: 'Per e-fold of chain count above the mean',
      recent: 'Shift for protocols listed in the last year'
    };
    var ct = document.querySelector('#coefs tbody');
    fit.coefficients.forEach(function (c) {
      var meaning = meanings[c.term] || ('Shift for the ' + c.term.slice(4) + ' category');
      ct.appendChild(el('tr', null,
        el('td', { text: c.term }),
        el('td', { class: 'num', text: (c.value >= 0 ? '+' : '') + c.value.toFixed(4) }),
        el('td', { class: 'sub', text: meaning })
      ));
    });
    var ot = document.querySelector('#odds tbody');
    DATA.odds.buckets.forEach(function (b) {
      ot.appendChild(el('tr', null,
        el('td', { text: b.label }),
        el('td', { class: 'num', text: String(b.n) }),
        el('td', { class: 'num', text: String(b.with_token) }),
        el('td', { class: 'num', text: (b.rate * 100).toFixed(1) + '%' }),
        el('td', { class: 'num', text: (b.odds * 100).toFixed(1) + '%' })
      ));
    });
    ot.appendChild(el('tr', null,
      el('td', { text: 'Age unknown' }),
      el('td', { class: 'num', text: '—' }),
      el('td', { class: 'num', text: '—' }),
      el('td', { class: 'num', text: '—' }),
      el('td', { class: 'num', text: (DATA.odds.global * 100).toFixed(1) + '% (global)' })
    ));
    document.getElementById('brier-line').textContent = 'Brier score ' + DATA.odds.brier.toFixed(3) + ' in-sample and ' + DATA.odds.brier_loo.toFixed(3) + ' leave-one-out, against a ' + DATA.odds.brier_base.toFixed(3) + ' base rate — the age buckets beat guessing the global share for every protocol.';
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
    var vd = document.getElementById('verdict');
    vd.value = state.verdict;
    vd.addEventListener('change', function () { state.verdict = vd.value; writeHash(); render(); });
    var gp = document.getElementById('group');
    gp.value = state.group;
    gp.addEventListener('change', function () { state.group = gp.value; writeHash(); render(); });
    var pre = document.getElementById('tab-pre');
    var live = document.getElementById('tab-live');
    var ledger = document.getElementById('tab-ledger');
    function setTab(tab) {
      state.tab = tab;
      pre.setAttribute('aria-pressed', tab === 'pre-token' ? 'true' : 'false');
      live.setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
      ledger.setAttribute('aria-pressed', tab === 'ledger' ? 'true' : 'false');
      document.getElementById('verdict-field').classList.toggle('hidden', tab !== 'pre-token');
      document.getElementById('group-field').classList.toggle('hidden', tab !== 'ledger');
      writeHash(); render();
    }
    pre.addEventListener('click', function () { setTab('pre-token'); });
    live.addEventListener('click', function () { setTab('live'); });
    ledger.addEventListener('click', function () { setTab('ledger'); });
    setTab(state.tab);
    var sh = document.getElementById('w-share');
    var sc = document.getElementById('w-scale');
    var note = document.getElementById('w-note');
    function applySandbox() {
      econ = { share: parseFloat(sh.value) / 100, scale: parseFloat(sc.value) };
      document.getElementById('w-share-out').textContent = sh.value + '%';
      document.getElementById('w-scale-out').textContent = parseFloat(sc.value).toFixed(1) + '×';
      state.sandbox = econ.share !== DATA.model.airdrop_share || econ.scale !== 1;
      note.textContent = state.sandbox ? 'Sandbox verdicts — move the sliders back or reset to return to the submitted verdicts.' : 'Showing the submitted verdicts.';
      render();
    }
    sh.addEventListener('input', applySandbox);
    sc.addEventListener('input', applySandbox);
    document.getElementById('w-reset').addEventListener('click', function () {
      sh.value = DATA.model.airdrop_share * 100; sc.value = 1; applySandbox();
    });
  }

  function render() {
    board.textContent = '';
    board.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'live' ? liveTable() : ledgerTable());
    board.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });

  readHash();
  fillStatic();
  verify();
  wireControls();
  render();
})();
