(function () {
  'use strict';

  /* ================= helpers ================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtSize(n) { n = n || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
  function rel(ts) {
    var m = Math.floor(Math.max(0, Date.now() - ts) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function initials(n) { var p = String(n || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '·'; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  var toastTimer;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3400); }
  function setMsg(el, text, kind) { if (!el) return; el.textContent = text || ''; el.className = (el.className.replace(/\b(err|ok)\b/g, '').trim() + (kind ? ' ' + kind : '')).trim(); }
  function armConfirm(btn, go) { // two-step delete without window.confirm (blocked in sandboxed pages)
    if (btn.dataset.armed) { clearTimeout(+btn.dataset.armed); delete btn.dataset.armed; go(); return; }
    var orig = btn.innerHTML; btn.classList.add('confirm'); btn.textContent = 'Sure?';
    btn.dataset.armed = String(setTimeout(function () { btn.classList.remove('confirm'); btn.innerHTML = orig; delete btn.dataset.armed; }, 3000));
  }

  /* ================= state ================= */
  var S = {
    ready: false, live: false, open: false, uid: null, isOwner: false,
    profile: null, account: null,
    authorities: [], links: [], activity: [], files: [], profiles: [], inbox: [],
    view: 'home', pane: 'repo', rtab: 'authorities', graphSel: null, graphFirst: true, bill: 'm', draftLoaded: false
  };
  /* ---- tiny API client: JSON in/out, cookie session, CSRF header ---- */
  function api(method, url, body, opts) {
    opts = opts || {};
    var headers = { 'x-requested-with': 'dike' }, payload;
    if (opts.raw) { payload = body; for (var h in opts.headers) headers[h] = opts.headers[h]; }
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    return fetch(url, { method: method, headers: headers, body: payload, credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Request failed'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function nameOf(uid) {
    if (uid === 'seed') return 'Sample data';
    var p = byId(S.profiles, uid); return p ? p.name : 'A member';
  }
  function statsFor(uid) {
    var mine = S.authorities.filter(function (a) { return a.addedBy === uid; });
    return {
      added: mine.length,
      cited: mine.reduce(function (n, a) { return n + (a.citations || 0); }, 0),
      files: S.files.filter(function (f) { return f.by === uid; }).length,
      links: S.links.filter(function (l) { return l.by === uid; }).length
    };
  }
  function log() { /* the server records activity for every change */ }

  /* ================= data: one /api/state call, refreshed after changes and every 20 s ================= */
  function load() {
    return api('GET', '/api/state').then(function (st) {
      S.live = true; S.open = !!st.open;
      S.uid = st.me ? st.me.id : null; S.isOwner = !!(st.me && st.me.isAdmin); S.profile = st.me ? st.me.profile : null;
      S.account = st.me ? { email: st.me.email } : null;
      S.authorities = st.authorities; S.links = st.links; S.files = st.files; S.activity = st.activity; S.profiles = st.profiles; S.inbox = st.inbox;
      S.ready = true; prefillContact(); refresh();
    }).catch(function () { S.live = false; S.ready = true; refresh(); });
  }
  function init() {
    load();
    setInterval(function () {
      var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!document.hidden && !typing) load();
    }, 20000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  }
  var rafId = 0;
  function refresh() { if (rafId) return; rafId = requestAnimationFrame(function () { rafId = 0; renderAll(); }); }
  function renderAll() {
    renderAuth();
    if (S.view === 'home') renderHome();
    if (S.view === 'app') renderApp();
    else if (S.view === 'community') renderCommunity();
    else if (S.view === 'login') renderLogin();
    else if (S.view === 'pricing') renderPricing(true);
    else if (S.view === 'contact') prefillContact();
  }

  /* ================= header auth area ================= */
  function renderAuth() {
    var a = $('#auth-area'), m = $('#mobile-auth'), p = S.profile;
    if (p) {
      a.innerHTML = '<a href="#/app" class="user-chip"><span class="avatar">' + esc(initials(p.name)) + '</span>Workspace</a>';
      m.innerHTML = '<a href="#/app">Open workspace →</a>';
    } else {
      a.innerHTML = '<a href="#/login" class="nav-signin">Sign in</a><a href="#/signup" class="pill">Create account</a>';
      m.innerHTML = '<a href="#/login">Sign in</a><a href="#/signup">Create account →</a>';
    }
    $$('.nav-links a').forEach(function (l) {
      var h = l.getAttribute('href') || ''; var on = h.indexOf('#/') === 0 && location.hash.indexOf(h) === 0;
      l.classList.toggle('on', on);
    });
  }

  /* ================= router ================= */
  var NAMES = ['home', 'signup', 'login', 'contact', 'pricing', 'community', 'app'];
  function route() {
    var h = location.hash || '';
    if (h.indexOf('#/') === 0) {
      var parts = h.slice(2).split('/'); var name = parts[0] || 'home';
      if (NAMES.indexOf(name) === -1) name = 'home';
      showView(name, parts[1] || '');
    } else {
      showView('home', '');
      var el = h.length > 1 ? document.getElementById(h.slice(1)) : null;
      setTimeout(function () { if (el) el.scrollIntoView(); else window.scrollTo(0, 0); }, 0);
    }
  }
  function showView(name, sub) {
    var changed = S.view !== name;
    S.view = name;
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    var v = $('#view-' + name); document.title = (v && v.getAttribute('data-title')) || 'DÍKĒ — Legal Intelligence Platform';
    if (name !== 'home' && changed) window.scrollTo(0, 0);
    if (name === 'app') { if (sub && ['repo', 'research', 'graph', 'draft', 'profile', 'inbox'].indexOf(sub) > -1) S.pane = sub; }
    if (name === 'contact') { prefillContact(); if (sub) { var map = { practice: 'Practice plan', firm: 'Firm plan' }; if (map[sub]) $('#ct-topic').value = map[sub]; } }
    if (name === 'signup') { setMsg($('#su-msg'), ''); if (S.profile) { location.hash = '#/login'; return; } }
    if (name === 'pricing') renderPricing(false);
    if (changed && (name === 'app' || name === 'community')) load();   // fresh data whenever you open these pages
    if (name === 'home') setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 0);
    renderAll();
  }
  window.addEventListener('hashchange', route);

  /* ================= create account ================= */
  $('#signup-main').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#su-msg'), btn = $('#su-submit');
    var name = $('#su-name').value.trim(), email = $('#su-email').value.trim(), pw = $('#su-password').value;
    var year = parseInt($('#su-year').value, 10);
    if (name.length < 2) return setMsg(msg, 'Please enter your full name.', 'err');
    if (!isEmail(email)) return setMsg(msg, 'Please enter a valid email address.', 'err');
    if (pw.length < 8) return setMsg(msg, 'Choose a password of at least 8 characters.', 'err');
    if (!isNaN(year) && (year < 1950 || year > new Date().getFullYear())) return setMsg(msg, 'Enrolment year should be between 1950 and this year.', 'err');
    if (!$('#su-consent').checked) return setMsg(msg, 'Please tick the box to confirm you understand what is stored.', 'err');
    if (S.profile) { location.hash = '#/login'; return; }
    btn.disabled = true; setMsg(msg, 'Creating your account…');
    api('POST', '/api/auth/register', { name: name, email: email, password: pw, practice: $('#su-practice').value, city: $('#su-city').value.trim(), enrolYear: isNaN(year) ? null : year, public: $('#su-public').checked, consent: true })
      .then(load).then(function () {
        $('#su-password').value = ''; setMsg(msg, ''); toast('Welcome, ' + name.split(' ')[0] + ' — your workspace is ready.');
        location.hash = '#/app/repo';
      }).catch(function (err) { setMsg(msg, err.message || 'Something went wrong. Please try again.', 'err'); })
      .then(function () { btn.disabled = false; });
  });

  /* ================= sign in ================= */
  function renderLogin() {
    var c = $('#login-card'), p = S.profile, h;
    if (c.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // don't disturb typing
    if (!S.ready) h = '<p class="sub">Checking your session…</p>';
    else if (!S.live) h = '<a href="#/" class="back-link">← Back home</a><p class="label">Sign in</p><h1>Sign in</h1><p class="sub">We can\'t reach the server right now. Please try again in a moment.</p>';
    else if (p) h = '<a href="#/" class="back-link">← Back home</a><p class="label">Welcome back</p><h1>Hello, ' + esc(p.name.split(' ')[0]) + '.</h1><p class="sub">You\'re signed in. Your repository, drafts and profile are right where you left them.</p><div style="display:flex;gap:12px;flex-wrap:wrap;"><a href="#/app" class="a-btn">Open workspace</a><a href="#/community" class="a-btn ghost">See the community</a><button type="button" class="a-btn ghost" id="logout-btn">Sign out</button></div>';
    else h = '<a href="#/" class="back-link">← Back home</a><p class="label">Welcome back</p><h1>Sign in</h1><p class="sub">Use the email and password you signed up with.</p>' +
      '<form id="login-form" novalidate><label class="field"><span>Email</span><input id="li-email" type="email" autocomplete="email" maxlength="120"></label>' +
      '<label class="field"><span>Password</span><input id="li-password" type="password" autocomplete="current-password" maxlength="200"></label>' +
      '<button type="submit" class="a-btn block" id="li-submit">Sign in</button><p class="form-msg" id="li-msg" role="alert"></p></form>' +
      '<p class="alt-line">New here? <a href="#/signup">Create an account</a></p>';
    c.innerHTML = h;
  }
  $('#login-card').addEventListener('submit', function (e) {
    if (e.target.id !== 'login-form') return; e.preventDefault();
    var msg = $('#li-msg'), btn = $('#li-submit'), email = $('#li-email').value.trim(), pw = $('#li-password').value;
    if (!isEmail(email) || !pw) return setMsg(msg, 'Enter your email and password.', 'err');
    btn.disabled = true; setMsg(msg, 'Signing in…');
    api('POST', '/api/auth/login', { email: email, password: pw }).then(load).then(function () { toast('Signed in.'); location.hash = '#/app/repo'; })
      .catch(function (err) { setMsg(msg, err.message || 'Could not sign in.', 'err'); btn.disabled = false; });
  });
  function signOut() {
    api('POST', '/api/auth/logout').then(function () { S.draftLoaded = false; $('#draft-title').value = ''; $('#draft-body').value = ''; return load(); })
      .then(function () { toast('Signed out.'); location.hash = '#/'; });
  }
  document.addEventListener('click', function (e) { if (e.target.closest('#logout-btn')) signOut(); });

  /* ================= contact + early-access inbox ================= */
  var sending = false;
  function sendInbox(msg) {
    if (!S.live) return Promise.reject({ code: 'no_server' });
    if (sending) return Promise.reject({ code: 'busy' });
    sending = true;
    return api('POST', '/api/contact', msg).then(function () { sending = false; }, function (e) { sending = false; throw e; });
  }
  function mailto(subject, body) { return 'mailto:dikeindiapvtltd@gmail.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  function prefillContact() {
    var n = $('#ct-name'), e = $('#ct-email');
    if (n && !n.value && S.profile) n.value = S.profile.name;
    if (e && !e.value && S.account && S.account.email) e.value = S.account.email;
  }
  $('#contact-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#ct-msg'), btn = $('#ct-submit');
    var name = $('#ct-name').value.trim(), email = $('#ct-email').value.trim(), topic = $('#ct-topic').value, text = $('#ct-message').value.trim();
    if (name.length < 2) return setMsg(msg, 'Please enter your name.', 'err');
    if (!isEmail(email)) return setMsg(msg, 'Please enter a valid email address.', 'err');
    if (text.length < 5) return setMsg(msg, 'Please write a short message.', 'err');
    btn.disabled = true; setMsg(msg, 'Sending…');
    sendInbox({ type: 'contact', name: name, email: email, topic: topic, message: text }).then(function () {
      $('#ct-message').value = ''; setMsg(msg, 'Thank you — your message has been received.', 'ok');
    }).catch(function (err) {
      if (err && err.status === 400) return setMsg(msg, err.message, 'err');
      window.open(mailto('DÍKĒ — ' + topic, 'From: ' + name + ' <' + email + '>\n\n' + text), '_blank');
      setMsg(msg, 'We couldn\'t save that here, so we opened your email app with the message ready to send.', 'err');
    }).then(function () { btn.disabled = false; });
  });
  var homeBtn = $('#signup-btn');
  if (homeBtn) homeBtn.addEventListener('click', function () {
    var note = $('#signup-note'), val = $('#email').value.trim();
    if (!isEmail(val)) { note.textContent = 'Enter a valid email address.'; return; }
    homeBtn.disabled = true; homeBtn.textContent = 'Sending…';
    sendInbox({ type: 'early-access', name: S.profile ? S.profile.name : '', email: val, topic: 'Early access', message: 'Requested early access from the home page.' }).then(function () {
      $('#signup-form').style.display = 'none'; note.textContent = 'Thanks — we\'ll be in touch.';
    }).catch(function (err) {
      if (err && err.status === 429) { note.textContent = err.message; homeBtn.disabled = false; homeBtn.textContent = 'Request access'; return; }
      window.open(mailto('DÍKĒ — early access', 'Please add ' + val + ' to the early access list.'), '_blank');
      note.textContent = 'We opened your email app with the request ready to send.';
      homeBtn.disabled = false; homeBtn.textContent = 'Request access';
    });
  });

  /* ================= pricing ================= */
  var PLANS = [
    { id: 'starter', name: 'Starter', price: 0, desc: 'For individual lawyers getting their research in order.', feats: ['Personal repository', 'Citation graph', 'Community profile'], cta: 'Create account', href: '#/signup' },
    { id: 'practice', name: 'Practice', price: 4999, desc: 'For active practitioners who draft, cite and research daily.', feats: ['Everything in Starter', 'Research across your repository', 'Drafts with built-in citations'], cta: 'Request access', href: '#/contact/practice', featured: true },
    { id: 'firm', name: 'Firm', price: 14999, desc: 'For teams that need shared records and governed collaboration.', feats: ['Everything in Practice', 'Shared team repository', 'Priority support'], cta: 'Talk to us', href: '#/contact/firm' }
  ];
  function inr(n) { return '₹' + n.toLocaleString('en-IN'); }
  function renderPricing(keep) {
    var g = $('#plan-grid'); if (!g) return;
    g.innerHTML = PLANS.map(function (p) {
      var per = S.bill === 'y' ? Math.round(p.price * 0.8) : p.price;
      var sub = p.price === 0 ? 'Free, no card needed' : (S.bill === 'y' ? 'Billed yearly — ' + inr(per * 12) : 'Billed monthly');
      return '<div class="plan' + (p.featured ? ' featured' : '') + '">' + (p.featured ? '<span class="tag">Most chosen</span>' : '') +
        '<h3>' + esc(p.name) + '</h3><p class="desc">' + esc(p.desc) + '</p>' +
        '<div class="price">' + (p.price === 0 ? 'Free' : inr(per) + '<small>/ month</small>') + '</div><div class="price-sub">' + sub + '</div>' +
        '<ul>' + p.feats.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
        '<a class="a-btn' + (p.featured ? '' : ' ghost') + '" href="' + p.href + '">' + esc(p.cta) + '</a></div>';
    }).join('');
    $$('#bill-seg button').forEach(function (b) { b.classList.toggle('active', b.dataset.bill === S.bill); });
  }
  $('#bill-seg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S.bill = b.dataset.bill; renderPricing(true); });

  /* ================= community ================= */
  function renderCommunity() {
    var pub = S.profiles.filter(function (p) { return p.public; }).map(function (p) { var st = statsFor(p.id); return { p: p, st: st }; });
    pub.sort(function (a, b) { return (b.st.added + b.st.cited) - (a.st.added + a.st.cited) || (b.p.createdAt || 0) - (a.p.createdAt || 0); });
    var totalCites = S.authorities.reduce(function (n, a) { return n + (a.citations || 0); }, 0);
    $('#mem-stats').innerHTML = '<div><b>' + S.profiles.filter(function (p) { return p.public; }).length + '</b><span>public profiles</span></div><div><b>' + S.authorities.length + '</b><span>authorities on record</span></div><div><b>' + totalCites + '</b><span>citations made</span></div>';
    var cards = pub.map(function (m) {
      var p = m.p; var role = [p.practice, p.city].filter(Boolean).join(' · ');
      return '<div class="mem-card"><div class="mem-top"><span class="avatar lg" style="width:54px;height:54px;font-size:17px;">' + esc(initials(p.name)) + '</span><div><div class="mem-name">' + esc(p.name) + '</div><div class="mem-role">' + esc(role || 'Legal professional') + '</div></div></div>' +
        '<div class="mem-nums"><div><b>' + m.st.added + '</b><span>Authorities added</span></div><div><b>' + m.st.cited + '</b><span>Citations received</span></div></div>' +
        '<div class="mem-foot">' + (p.enrolYear ? 'Enrolled ' + esc(p.enrolYear) + ' (self-declared) · ' : '') + 'Joined ' + esc(new Date(p.createdAt || Date.now()).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })) + '</div></div>';
    }).join('');
    var cta = !S.profile ? '<div class="mem-card mem-cta"><div class="mem-name">Your profile could be here.</div><div class="mem-role">Add authorities, get cited, and let your work speak.</div><a href="#/signup" class="a-btn sm">Create account</a></div>' : '';
    $('#mem-grid').innerHTML = (cards || (cta ? '' : '<div class="empty" style="grid-column:1/-1;">No public profiles yet.</div>')) + cta;
  }

  /* ================= landing page (live data; a small demo set only outside Claude) ================= */
  var SAMPLE_AUTH = [
    { id: 's1', title: 'Article 21 — right to life and personal liberty', kind: 'statute', court: 'Constitution of India', year: 1950, citations: 14 },
    { id: 's2', title: 'Kesavananda Bharati v. State of Kerala', kind: 'judgment', court: 'Supreme Court of India', year: 1973, citations: 9 },
    { id: 's3', title: 'Doctrine of basic structure — note', kind: 'note', court: 'Firm note', year: null, citations: 5 },
    { id: 's4', title: 'Justice K.S. Puttaswamy (Retd.) v. Union of India', kind: 'judgment', court: 'Supreme Court of India', year: 2017, citations: 3 }
  ];
  var SAMPLE_LINKS = [{ id: 'sl1', from: 's4', to: 's1' }, { id: 'sl2', from: 's4', to: 's2' }, { id: 'sl3', from: 's3', to: 's2' }];
  function nodeRad(n) { return 11 + Math.sqrt(n.citations || 0) * 2.8; }
  function homeData() { return S.live && S.open ? { a: S.authorities, l: S.links, live: true } : { a: SAMPLE_AUTH, l: SAMPLE_LINKS, live: false }; }
  function sortedByCites(a) { return a.slice().sort(function (x, y) { return (y.citations || 0) - (x.citations || 0) || String(x.title).localeCompare(String(y.title)); }); }
  var layoutCache = {}, layoutCount = 0;
  function memoLayout(nodes, links) {
    var key = nodes.map(function (n) { return n.id; }).sort().join('|') + '#' + links.map(function (l) { return l.from + '>' + l.to; }).sort().join('|');
    if (!layoutCache[key]) { if (layoutCount > 8) { layoutCache = {}; layoutCount = 0; } layoutCache[key] = layout(nodes, links, 560, 330); layoutCount++; }
    return layoutCache[key];
  }
  function wrapLabel(s, max) {          // up to two lines, never a hard cut mid-word
    var words = String(s).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (t.length > max && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    if (lines.length > 2) { lines = lines.slice(0, 2); lines[1] = trunc(lines[1] + '…', max); }
    return lines.map(function (l) { return l.length > max ? trunc(l, max) : l; });
  }
  function drawMini(svg, nodes, links, pos, opt) {
    if (!svg) return; opt = opt || {};
    var sig = nodes.map(function (n) { return n.id + ':' + (n.citations || 0); }).join(',') + '|' + links.map(function (l) { return l.from + '>' + l.to; }).join(',') + '|' + (opt.hi || '') + '|' + (window.innerWidth < 760 ? 'm' : 'd');
    if (svg.dataset.sig === sig) return; svg.dataset.sig = sig;
    if (!nodes.length) { svg.innerHTML = '<text class="g-empty" x="280" y="165" text-anchor="middle">Add authorities to see the graph take shape.</text>'; return; }
    var animate = !opt.still, mid = 'arr-' + (opt.id || 'm'), map = {}, mx = window.innerWidth < 760 ? 14 : (opt.max || 20);
    nodes.forEach(function (n) { map[n.id] = n; });
    var html = '<defs><marker id="' + mid + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="rgba(45,58,140,.55)"/></marker></defs>';
    links.forEach(function (l) {
      var A = map[l.from], B = map[l.to]; if (!A || !B || !pos[l.from] || !pos[l.to]) return;
      var a = pos[l.from], b = pos[l.to], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      html += '<line class="g-edge" x1="' + (a.x + dx / d * (nodeRad(A) + 2)).toFixed(1) + '" y1="' + (a.y + dy / d * (nodeRad(A) + 2)).toFixed(1) + '" x2="' + (b.x - dx / d * (nodeRad(B) + 5)).toFixed(1) + '" y2="' + (b.y - dy / d * (nodeRad(B) + 5)).toFixed(1) + '" marker-end="url(#' + mid + ')"/>';
    });
    nodes.forEach(function (n, i) {
      var p = pos[n.id]; if (!p) return; var r = nodeRad(n), inner = '';
      if (!opt.noLabels) {
        var lines = wrapLabel(n.title, mx).map(function (ln, k) { return '<tspan x="0" dy="' + (k ? 15 : 0) + '">' + esc(ln) + '</tspan>'; }).join('');
        inner = '<text class="g-count" text-anchor="middle" dy=".35em">' + (n.citations || 0) + '</text><text y="' + (r + 16).toFixed(1) + '" text-anchor="middle">' + lines + '</text>';
      }
      html += '<g transform="translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')"><g class="g-node mini' + (opt.hi === n.id ? ' hi' : '') + (animate ? ' g-pop' : ' g-static') + '" style="--d:' + i * 90 + 'ms"><circle r="' + r.toFixed(1) + '"/>' + inner + '</g></g>';
    });
    svg.innerHTML = html;
  }

  /* ---------- the landing page ---------- */
  function renderHome() {
    if (!$('#pillar-graph')) return;
    var d = homeData(), top = sortedByCites(d.a), sub = top.slice(0, 12), ids = {};
    sub.forEach(function (n) { ids[n.id] = 1; });
    var subLinks = d.l.filter(function (l) { return ids[l.from] && ids[l.to]; });
    var pos = sub.length ? memoLayout(sub, subLinks) : {};
        drawMini($('#pillar-graph'), sub, subLinks, pos, { id: 'pg', max: 20 });

    var recent = S.activity[0], weekAgo = Date.now() - 7 * 86400000;
    var citedWeek = S.activity.filter(function (a) { return a.type === 'cite' && a.at >= weekAgo; }).length;
    var nA = d.a.length, nL = d.l.length, word = nA === 1 ? ' authority' : ' authorities';
    $('#pillar-graph-count').textContent = nA + word;
    $('#pillar-updated').textContent = d.live ? 'Live' : 'Sample';
    $('#pillar-repo-rows').innerHTML = top.slice(0, 3).map(function (a) { return '<div class="panel-row"><span>' + esc(a.title) + '</span><span class="panel-badge">' + (a.citations || 0) + '</span></div>'; }).join('') || '<div class="empty" style="padding:22px;">No authorities yet.</div>';

    renderStrip(d);
    renderReputation(); renderHomeMosaic();
  }

  /* ---------- "The Record": four columns, each with one real number ---------- */
  function renderStrip(d) {
    if (!$('#st1')) return;
    var totalCites = d.a.reduce(function (n, a) { return n + (a.citations || 0); }, 0), nA = d.a.length, nL = d.l.length;
    $('#st1').textContent = nA; $('#st1c').textContent = nA === 1 ? 'authority to cite' : 'authorities to cite';
    $('#st2').textContent = totalCites; $('#st2c').textContent = totalCites === 1 ? 'citation' : 'citations';
    $('#st3').textContent = nL; $('#st3c').textContent = nL === 1 ? 'link drawn' : 'links drawn';
    var deg = {}; d.l.forEach(function (l) { deg[l.from] = (deg[l.from] || 0) + 1; deg[l.to] = (deg[l.to] || 0) + 1; });
    var best = null; d.a.forEach(function (a) { var g = deg[a.id] || 0; if (g && (!best || g > best.g || (g === best.g && (a.citations || 0) > (best.a.citations || 0)))) best = { a: a, g: g }; });
    $('#st4').textContent = best ? trunc(best.a.title, 30) : '—';
    $('#st4c').textContent = best ? 'most connected · ' + best.g + (best.g === 1 ? ' link' : ' links') : 'draw your first link';
  }

  /* ---------- reputation ---------- */
  function renderReputation() {
    var box = $('#rep-card'); if (!box) return;
    var pub = S.profiles.filter(function (p) { return p.public; }).map(function (p) { return { p: p, st: statsFor(p.id) }; });
    pub.sort(function (a, b) { return (b.st.added + b.st.cited) - (a.st.added + a.st.cited); });
    var m = S.live && pub.length ? pub[0] : null;
    var p = m ? m.p : { name: 'Sample Advocate', practice: 'Advocate', city: 'New Delhi', enrolYear: 2014 }, st = m ? m.st : { added: 84, cited: 31 };
    box.innerHTML = '<span class="rep-tag">' + (m ? 'Self-declared' : 'Sample profile') + '</span><div class="rep-top"><span class="avatar lg">' + esc(initials(p.name)) + '</span><div><div class="rep-name">' + esc(p.name) + '</div><div class="rep-role">' + esc([p.practice, p.city].filter(Boolean).join(' · ')) + '</div></div></div><div class="rep-nums"><div><b>' + st.added + '</b><span>Authorities added</span></div><div><b>' + st.cited + '</b><span>Citations received</span></div><div><b>' + esc(p.enrolYear || '—') + '</b><span>Bar enrolment</span></div></div>';
  }

  /* ---------- contribution history: real activity from the database, yours or everyone's ---------- */
  function buildMosaic(counts) {
    var cells = '', total = 0, today = new Date(); today.setHours(12, 0, 0, 0);
    for (var i = 111; i >= 0; i--) {
      var d = new Date(today.getTime() - i * 86400000), n = counts[dayKey(d.getTime())] || 0; total += n;
      var lv = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
      cells += '<i class="m-cell l' + lv + (i === 0 ? ' today' : '') + '" title="' + n + (n === 1 ? ' contribution' : ' contributions') + ' on ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '"></i>';
    }
    return { html: cells, total: total };
  }
  var histMode = null;
  function renderHomeMosaic() {
    var box = $('#home-mosaic'); if (!box) return;
    var haveMe = !!(S.uid && S.profile), mode = histMode || (haveMe ? 'me' : 'all'); if (mode === 'me' && !haveMe) mode = 'all';
    var counts = {}, seeded = false, cutoff = Date.now() - 112 * 86400000;
    S.activity.forEach(function (a) {
      if (mode === 'me' && a.by !== S.uid) return;
      if (a.by === 'seed' && a.at >= cutoff) seeded = true;
      var k = dayKey(a.at); counts[k] = (counts[k] || 0) + 1;
    });
    var m = buildMosaic(counts); box.innerHTML = m.html;
    $('#hist-seg').hidden = !haveMe;
    $$('#hist-seg button').forEach(function (b) { b.classList.toggle('active', b.dataset.hist === mode); });
    $('#hist-total').textContent = m.total;
    $('#hist-total-label').textContent = (mode === 'me' ? 'contributions from you' : 'contributions across the workspace') + ' in the last 16 weeks';
    var cap = $('#home-mosaic-cap');
    if (!S.live) cap.textContent = 'Can\u2019t reach the server right now.';
    else if (m.total === 0) cap.innerHTML = haveMe ? 'Nothing yet — add an authority to fill your first tile. <a class="pillar-link" href="#/app/repo">Open the workspace →</a>' : 'No contributions yet. <a class="pillar-link" href="#/signup">Create an account →</a>';
    else cap.textContent = seeded ? 'Includes sample activity.' : '';
  }
  $('#hist-seg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; histMode = b.dataset.hist; renderHomeMosaic(); });

  (function heroReplay() {   // the hero's entrance replays whenever you scroll back up to it
    var hero = $('#top'), inner = $('.hero-inner'); if (!hero || !inner || !('IntersectionObserver' in window)) return;
    var left = false;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) { left = true; return; }
        if (left && e.intersectionRatio >= 0.4) {
          left = false; inner.dataset.replays = String((+inner.dataset.replays || 0) + 1);
          Array.prototype.forEach.call(inner.children, function (c) { c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; });
        }
      });
    }, { threshold: [0, 0.4] }).observe(hero);
  })();

  /* ================= workspace ================= */
  function renderApp() {
    var gate = $('#app-gate'), shell = $('#app-shell');
    var msg = null;
    if (!S.ready) msg = { t: 'Loading your workspace…', p: '' };
    else if (!S.live) msg = { t: 'We can\'t reach the server', p: 'Please check your connection and try again in a moment.' };
    else if (!S.uid) msg = { t: 'Sign in to open your workspace', p: 'Your repository, drafts and profile are saved to your account.', btns: true };
    else if (!S.profile) msg = { t: 'Finish setting up your account', p: 'Your account has no profile yet. Create a new account to continue.', btns: true };
    if (msg) {
      shell.hidden = true;
      gate.innerHTML = '<div class="gate"><h2>' + esc(msg.t) + '</h2>' + (msg.p ? '<p>' + esc(msg.p) + '</p>' : '') + (msg.btns ? '<div class="btns"><a href="#/signup" class="a-btn">Create account</a><a href="#/login" class="a-btn ghost">Sign in</a></div>' : '') + '</div>';
      return;
    }
    gate.innerHTML = ''; shell.hidden = false;
    $('#app-who').textContent = S.profile.name + '’s workspace';
    $('#nav-inbox').hidden = !S.isOwner;
    if (S.pane === 'inbox' && !S.isOwner) S.pane = 'repo';
    $$('#app-nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.pane === S.pane); });
    $$('.pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === S.pane); });
    if (S.pane === 'repo') { if (S.pendingSearch) { S.rtab = 'authorities'; $('#repo-search').value = S.pendingSearch; S.pendingSearch = ''; } renderRepo(); }
    else if (S.pane === 'research') renderResearch();
    else if (S.pane === 'graph') renderGraph();
    else if (S.pane === 'draft') renderDraft();
    else if (S.pane === 'profile') renderProfile();
    else if (S.pane === 'inbox') renderInbox();
  }
  $('#app-nav').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) location.hash = '#/app/' + b.dataset.pane; });

  /* ---------- repository ---------- */
  function renderRepo() {
    $$('#repo-tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.rtab === S.rtab); });
    $('#rt-authorities').hidden = S.rtab !== 'authorities';
    $('#rt-files').hidden = S.rtab !== 'files';
    $('#rt-activity').hidden = S.rtab !== 'activity';
    if (S.rtab === 'authorities') renderRepoList();
    else if (S.rtab === 'files') renderFiles();
    else renderActivity();
  }
  $('#repo-tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S.rtab = b.dataset.rtab; renderRepo(); });
  var KIND = { judgment: 'Judgment', statute: 'Statute', note: 'Note' };
  function filteredAuthorities() {
    var q = ($('#repo-search').value || '').trim().toLowerCase(), kind = $('#repo-kind').value, sort = $('#repo-sort').value;
    var list = S.authorities.filter(function (a) {
      if (kind !== 'all' && a.kind !== kind) return false;
      return !q || ((a.title || '') + ' ' + (a.court || '') + ' ' + (a.year || '')).toLowerCase().indexOf(q) > -1;
    });
    list.sort(sort === 'new' ? function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); } : function (a, b) { return (b.citations || 0) - (a.citations || 0) || String(a.title).localeCompare(String(b.title)); });
    return list;
  }
  function renderRepoList() {
    var list = filteredAuthorities(), box = $('#repo-list');
    $('#repo-count').textContent = list.length + (list.length === 1 ? ' authority' : ' authorities') + (list.length !== S.authorities.length ? ' of ' + S.authorities.length : '');
    if (!list.length) { box.innerHTML = '<div class="empty">' + (S.authorities.length ? 'Nothing matches that search.' : 'Your repository is empty.<br>Add your first authority with the button above.') + '</div>'; return; }
    box.innerHTML = list.map(function (a, i) {
      var meta = [KIND[a.kind] || 'Authority', a.court, a.year].filter(Boolean).join(' · ') + ' · added by ' + nameOf(a.addedBy);
      var canDel = a.addedBy === S.uid || a.addedBy === 'seed' || S.isOwner;
      return '<div class="auth-row" style="animation-delay:' + Math.min(i, 8) * 40 + 'ms"><div><div class="auth-title">' + esc(a.title) + '</div><div class="auth-meta">' + esc(meta) + '</div></div><div class="auth-actions">' +
        '<button class="cite-btn" data-cite="' + esc(a.id) + '" title="Count a citation">Cite <b>' + (a.citations || 0) + '</b></button>' +
        (canDel ? '<button class="icon-btn" data-del="' + esc(a.id) + '" aria-label="Delete ' + esc(a.title) + '">×</button>' : '') + '</div></div>';
    }).join('');
  }
  ['repo-search', 'repo-kind', 'repo-sort'].forEach(function (id) { $('#' + id).addEventListener('input', renderRepoList); });
  $('#repo-list').addEventListener('click', function (e) {
    var c = e.target.closest('[data-cite]'); if (c) { citeAuthority(c.dataset.cite, c); return; }
    var d = e.target.closest('[data-del]'); if (d) armConfirm(d, function () { deleteAuthority(d.dataset.del); });
  });
  $('#repo-add-toggle').addEventListener('click', function () { var f = $('#repo-add-form'); f.hidden = !f.hidden; if (!f.hidden) $('#ra-title').focus(); });
  $('#ra-cancel').addEventListener('click', function () { $('#repo-add-form').hidden = true; setMsg($('#ra-msg'), ''); });
  $('#repo-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('#ra-title').value.trim(), year = parseInt($('#ra-year').value, 10), msg = $('#ra-msg');
    if (title.length < 3) return setMsg(msg, 'Give it a title.', 'err');
    var dupe = S.authorities.some(function (a) { return String(a.title).toLowerCase() === title.toLowerCase(); });
    if (dupe) return setMsg(msg, 'That authority is already in the repository.', 'err');
    api('POST', '/api/authorities', { title: title, kind: $('#ra-kind').value, court: $('#ra-court').value.trim(), year: isNaN(year) ? null : year }).then(function () {
      toast('Added to the repository.'); load();
      $('#ra-title').value = ''; $('#ra-court').value = ''; $('#ra-year').value = ''; setMsg(msg, ''); $('#repo-add-form').hidden = true;
    }).catch(function (err) { setMsg(msg, err.message || 'Could not save. Try again.', 'err'); });
  });
  function citeAuthority(id, btn, fromDraft) {
    var a = byId(S.authorities, id); if (!a) return Promise.resolve();
    if (btn) btn.disabled = true;
    return api('POST', '/api/authorities/' + id + '/cite', { from: fromDraft ? 'draft' : 'repo' }).then(load)
      .catch(function (err) { toast(err.message || 'Could not save that citation.'); }).then(function () { if (btn) btn.disabled = false; });
  }
  function deleteAuthority(id) {
    if (!byId(S.authorities, id)) return;
    api('DELETE', '/api/authorities/' + id).then(function () { if (S.graphSel === id) S.graphSel = null; return load(); })
      .catch(function (err) { toast(err.message || 'Could not delete that authority.'); });
  }

  /* ---------- files ---------- */
  var FTYPES = { pdf: 1, txt: 1, md: 1, csv: 1, json: 1, png: 1, jpg: 1, jpeg: 1, webp: 1 };
  function renderFiles() {
    $('#drop-text').innerHTML = '<b>Choose a file</b> or drop it here — PDF, text, Markdown, CSV, JSON or an image, up to 10 MB';
    var box = $('#file-list');
    if (!S.files.length) { box.innerHTML = '<div class="empty">No files yet.</div>'; return; }
    var list = S.files.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    box.innerHTML = list.map(function (f) {
      var ext = (String(f.name).split('.').pop() || 'file').slice(0, 4);
      var canDel = f.by === S.uid || S.isOwner;
      return '<div class="auth-row"><div class="file-left"><span class="file-ico">' + esc(ext) + '</span><div><div class="auth-title"><a href="/api/files/' + esc(f.id) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a></div><div class="auth-meta">' + esc(fmtSize(f.size)) + ' · ' + esc(nameOf(f.by)) + ' · ' + esc(rel(f.at)) + '</div></div></div>' +
        (canDel ? '<div class="auth-actions"><button class="icon-btn" data-delfile="' + esc(f.id) + '" aria-label="Delete ' + esc(f.name) + '">×</button></div>' : '') + '</div>';
    }).join('');
  }
  function uploadFile(file) {
    var msg = $('#file-msg'); if (!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!FTYPES[ext]) return setMsg(msg, 'That file type isn\'t supported. Try PDF, text, Markdown, CSV, JSON or an image.', 'err');
    if (file.size > 10 * 1048576) return setMsg(msg, 'That file is over 10 MB.', 'err');
    setMsg(msg, 'Uploading ' + file.name + '…');
    api('POST', '/api/files', file, { raw: true, headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' } })
      .then(function () { setMsg(msg, 'Uploaded ' + file.name + '.', 'ok'); return load(); })
      .catch(function (e) { setMsg(msg, e.message || 'Upload failed. Please try again.', 'err'); });
  }
  $('#drop-zone').addEventListener('click', function () { $('#file-input').click(); });
  $('#file-input').addEventListener('change', function (e) { uploadFile(e.target.files[0]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { $('#drop-zone').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { $('#drop-zone').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('over'); if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); }); });
  $('#file-list').addEventListener('click', function (e) {
    var d = e.target.closest('[data-delfile]'); if (!d) return;
    armConfirm(d, function () { api('DELETE', '/api/files/' + d.dataset.delfile).then(load).catch(function (err) { toast(err.message || 'Could not delete that file.'); }); });
  });

  /* ---------- activity ---------- */
  var AICON = { add: '+', cite: '❝', link: '⇄', upload: '↑', join: '★', draft: '✎', ask: '?', delete: '×' };
  function renderActivity() {
    var box = $('#act-list'); var list = S.activity.slice(0, 20);
    if (!list.length) { box.innerHTML = '<div class="empty">No activity yet — add an authority to get started.</div>'; return; }
    box.innerHTML = list.map(function (a) { return '<div class="act-row"><span class="act-ico">' + esc(AICON[a.type] || '•') + '</span><div><b>' + esc(nameOf(a.by)) + '</b> ' + esc(a.text) + '<span class="act-time">' + esc(rel(a.at)) + '</span></div></div>'; }).join('');
  }

  /* ---------- research (answers drawn only from the repository) ---------- */
  var asking = false;
  function renderResearch() {
    var chips = ['Which authorities deal with the right to privacy?', 'What is cited most in my repository?', 'Summarise what my repository says about constitutional rights'];
    var c = $('#ask-chips'); if (!c.dataset.done) { c.innerHTML = chips.map(function (t) { return '<button class="chip" type="button">' + esc(t) + '</button>'; }).join(''); c.dataset.done = '1'; }
  }
  $('#ask-chips').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b) { $('#ask-input').value = b.textContent; $('#ask-form').dispatchEvent(new Event('submit', { cancelable: true })); } });
  $('#ask-form').addEventListener('submit', function (e) {
    e.preventDefault(); if (asking) return;
    var q = $('#ask-input').value.trim(), out = $('#ask-out'), src = $('#ask-src'), btn = $('#ask-btn');
    if (q.length < 4) return;
    src.innerHTML = '';
    if (!S.authorities.length) { out.className = 'ask-out'; out.textContent = 'Your repository is empty, so there is nothing to draw an answer from. Add a few authorities first.'; return; }
    asking = true; btn.disabled = true; out.className = 'ask-out'; out.textContent = 'Reading your repository…';
    api('POST', '/api/research', { question: q }).then(function (r) {
      out.textContent = r.text;
      src.innerHTML = r.used && r.used.length ? 'Drawn from: ' + r.used.map(function (t) { return '<span class="src-chip">' + esc(t) + '</span>'; }).join('') : 'Considered ' + r.considered + ' authorities in your repository.';
      load();
    }).catch(function (err) { out.textContent = err.message || 'The research assistant is busy right now. Please try again in a moment.'; })
      .then(function () { asking = false; btn.disabled = false; });
  });

  /* ---------- citation graph ---------- */
  function layout(nodes, links, W, H) {
    var ids = nodes.map(function (n) { return n.id; }).sort(), pos = {}, vel = {};
    ids.forEach(function (id, i) { var a = i * 2.399963, r = 30 + 34 * Math.sqrt(i); pos[id] = { x: W / 2 + r * Math.cos(a), y: H / 2 + r * Math.sin(a) }; vel[id] = { x: 0, y: 0 }; });
    var edges = links.filter(function (l) { return pos[l.from] && pos[l.to]; });
    for (var it = 0; it < 260; it++) {
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
        var a = pos[ids[i]], b = pos[ids[j]], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2), f = 17000 / d2;
        vel[ids[i]].x += dx / d * f; vel[ids[i]].y += dy / d * f; vel[ids[j]].x -= dx / d * f; vel[ids[j]].y -= dy / d * f;
      }
      edges.forEach(function (l) {
        var a = pos[l.from], b = pos[l.to], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, f = (d - 170) * 0.02;
        vel[l.from].x += dx / d * f; vel[l.from].y += dy / d * f; vel[l.to].x -= dx / d * f; vel[l.to].y -= dy / d * f;
      });
      ids.forEach(function (id) {
        vel[id].x += (W / 2 - pos[id].x) * 0.006; vel[id].y += (H / 2 - pos[id].y) * 0.009;
        pos[id].x = Math.max(80, Math.min(W - 80, pos[id].x + vel[id].x)); pos[id].y = Math.max(44, Math.min(H - 52, pos[id].y + vel[id].y));
        vel[id].x *= 0.82; vel[id].y *= 0.82;
      });
    }
    return pos;
  }
  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function renderGraph() {
    var svg = $('#graph-svg'), W = 640, H = 420, nodes = S.authorities, links = S.links.filter(function (l) { return byId(nodes, l.from) && byId(nodes, l.to); });
    if (S.graphSel && !byId(nodes, S.graphSel)) S.graphSel = null;
    $('#graph-legend').textContent = nodes.length + ' authorities · ' + links.length + ' links';
    if (!nodes.length) { svg.innerHTML = '<text x="320" y="210" text-anchor="middle" fill="#5B5750" font-size="15">Add authorities, then link them to see the graph.</text>'; $('#graph-side').innerHTML = '<p class="muted" style="margin:0;">Nothing to show yet.</p>'; return; }
    var pos = layout(nodes, links, W, H), sel = S.graphSel;
    var near = {}; if (sel) { near[sel] = 1; links.forEach(function (l) { if (l.from === sel) near[l.to] = 1; if (l.to === sel) near[l.from] = 1; }); }
    var rad = nodeRad;
    var html = '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="rgba(45,58,140,.55)"/></marker></defs>';
    links.forEach(function (l) {
      var a = pos[l.from], b = pos[l.to], A = byId(nodes, l.from), B = byId(nodes, l.to), dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var x1 = a.x + dx / d * (rad(A) + 2), y1 = a.y + dy / d * (rad(A) + 2), x2 = b.x - dx / d * (rad(B) + 5), y2 = b.y - dy / d * (rad(B) + 5);
      var dim = sel && !(l.from === sel || l.to === sel);
      html += '<line class="g-edge' + (dim ? ' g-dim' : '') + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" marker-end="url(#arr)"/>';
    });
    nodes.forEach(function (n, i) {
      var p = pos[n.id], dim = sel && !near[n.id];
      html += '<g transform="translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')"><g class="g-node' + (n.id === sel ? ' sel' : '') + (dim ? ' g-dim' : '') + (S.graphFirst ? ' g-in' : '') + '" data-node="' + esc(n.id) + '" style="animation-delay:' + i * 70 + 'ms"><circle r="' + rad(n).toFixed(1) + '"/><text y="' + (rad(n) + 14).toFixed(1) + '" text-anchor="middle">' + esc(trunc(n.title, 26)) + '</text></g></g>';
    });
    svg.innerHTML = html; S.graphFirst = false;
    renderGraphSide(links);
  }
  function renderGraphSide(links) {
    var side = $('#graph-side'), n = byId(S.authorities, S.graphSel);
    if (!n) { side.innerHTML = '<h3>Select an authority</h3><p class="meta">Click a node to see what it cites, what cites it, and to link it to another authority.</p>'; return; }
    var out = links.filter(function (l) { return l.from === n.id; }), inc = links.filter(function (l) { return l.to === n.id; });
    var linkedTo = {}; out.forEach(function (l) { linkedTo[l.to] = 1; });
    var options = S.authorities.filter(function (a) { return a.id !== n.id && !linkedTo[a.id]; });
    function row(l, otherId, canDel) { var o = byId(S.authorities, otherId); return '<div class="link-line"><span>' + esc(o ? trunc(o.title, 34) : '?') + '</span>' + (canDel ? '<button class="icon-btn" data-unlink="' + esc(l.id) + '" aria-label="Remove link">×</button>' : '') + '</div>'; }
    side.innerHTML = '<h3>' + esc(n.title) + '</h3><div class="meta">' + esc([KIND[n.kind], n.court, n.year].filter(Boolean).join(' · ')) + ' · cited ' + (n.citations || 0) + '×</div>' +
      '<h4>Cites</h4>' + (out.length ? out.map(function (l) { return row(l, l.to, true); }).join('') : '<div class="meta" style="margin:0">Nothing yet</div>') +
      '<h4>Cited by</h4>' + (inc.length ? inc.map(function (l) { return row(l, l.from, false); }).join('') : '<div class="meta" style="margin:0">Nothing yet</div>') +
      '<h4>Link this authority</h4>' + (options.length ? '<select id="link-target" aria-label="Authority this one cites">' + options.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(trunc(a.title, 44)) + '</option>'; }).join('') + '</select><button class="a-btn sm" id="link-add" type="button">This cites →</button>' : '<div class="meta" style="margin:0">Add more authorities to link them.</div>');
  }
  $('#graph-svg').addEventListener('click', function (e) { var n = e.target.closest('[data-node]'); S.graphSel = n ? (S.graphSel === n.dataset.node ? null : n.dataset.node) : null; renderGraph(); });
  $('#graph-side').addEventListener('click', function (e) {
    var u = e.target.closest('[data-unlink]');
    if (u) { api('DELETE', '/api/links/' + u.dataset.unlink).then(load).catch(function (err) { toast(err.message || 'Could not remove that link.'); }); return; }
    if (e.target.id === 'link-add') {
      var to = $('#link-target').value, from = S.graphSel; if (!to || !from) return;
      e.target.disabled = true;
      api('POST', '/api/links', { from: from, to: to }).then(function () { toast('Linked.'); return load(); })
        .catch(function (err) { toast(err.message || 'Could not save that link.'); e.target.disabled = false; });
    }
  });

  /* ---------- draft ---------- */
  var draftTimer, draftDirty = false;
  function loadDraft() {
    if (S.draftLoaded || !S.uid) return; S.draftLoaded = true;
    api('GET', '/api/draft').then(function (d) {
      if (!$('#draft-title').value) $('#draft-title').value = d.title || '';
      if (!$('#draft-body').value) $('#draft-body').value = d.body || '';
      countWords();
    }).catch(function () { S.draftLoaded = false; });
  }
  function countWords() { var t = $('#draft-body').value.trim(); $('#draft-words').textContent = (t ? t.split(/\s+/).length : 0) + ' words'; }
  function saveDraft() {
    var st = $('#draft-status'); st.textContent = 'Saving…';
    api('PUT', '/api/draft', { title: $('#draft-title').value, body: $('#draft-body').value })
      .then(function () { draftDirty = false; st.textContent = 'Saved · private to you'; }).catch(function () { st.textContent = 'Couldn’t save — will retry'; });
  }
  function onDraftInput() { countWords(); draftDirty = true; $('#draft-status').textContent = 'Editing…'; clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 800); }
  $('#draft-title').addEventListener('input', onDraftInput); $('#draft-body').addEventListener('input', onDraftInput);
  function renderDraft() {
    loadDraft();
    var q = ($('#pick-search').value || '').trim().toLowerCase();
    var list = S.authorities.filter(function (a) { return !q || String(a.title).toLowerCase().indexOf(q) > -1; }).sort(function (a, b) { return (b.citations || 0) - (a.citations || 0); });
    $('#pick-list').innerHTML = list.length ? list.map(function (a) { return '<div class="pick-row"><span>' + esc(trunc(a.title, 48)) + '</span><button class="a-btn sm ghost" data-pick="' + esc(a.id) + '" type="button">Cite</button></div>'; }).join('') : '<div class="meta" style="font-size:13px;color:var(--ink-soft);">' + (S.authorities.length ? 'No match.' : 'Add authorities in the repository first.') + '</div>';
  }
  $('#pick-search').addEventListener('input', renderDraft);
  $('#pick-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]'); if (!b) return;
    var a = byId(S.authorities, b.dataset.pick); if (!a) return;
    var ta = $('#draft-body'), s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, en = ta.selectionEnd == null ? s : ta.selectionEnd, ins = '[' + a.title + ']';
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(en); ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length;
    onDraftInput(); citeAuthority(a.id, b, true);
  });
  $('#draft-copy').addEventListener('click', function () {
    var text = ($('#draft-title').value ? $('#draft-title').value + '\n\n' : '') + $('#draft-body').value;
    function fallback() { var ta = $('#draft-body'); ta.focus(); ta.select(); try { document.execCommand('copy'); toast('Draft copied.'); } catch (e) { toast('Select the text and copy it manually.'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Draft copied.'); }, fallback); else fallback();
  });
  window.addEventListener('pagehide', function () { if (draftDirty && S.uid) saveDraft(); });

  /* ---------- profile + contribution mosaic ---------- */
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function renderProfile() {
    var p = S.profile, st = statsFor(S.uid), box = $('#profile-body');
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // don't disturb typing
    var counts = {}; S.activity.forEach(function (a) { if (a.by === S.uid) { var k = dayKey(a.at); counts[k] = (counts[k] || 0) + 1; } });
    var mo = buildMosaic(counts), cells = mo.html, total = mo.total;
    var yrs = new Date().getFullYear();
    var opts = ['Litigation', 'Corporate & transactional', 'In-house counsel', 'Judiciary', 'Academia / student', 'Other'].map(function (o) { return '<option' + (o === p.practice ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    box.innerHTML = '<div class="prof-head"><span class="avatar lg">' + esc(initials(p.name)) + '</span><div><h2>' + esc(p.name) + '</h2><div class="muted" style="margin:4px 0 0;">' + esc([p.practice, p.city].filter(Boolean).join(' · ')) + (p.enrolYear ? ' · enrolled ' + esc(p.enrolYear) + ' (self-declared)' : '') + '</div></div></div>' +
      '<div class="stat-grid"><div><b>' + st.added + '</b><span>Authorities added</span></div><div><b>' + st.cited + '</b><span>Citations received</span></div><div><b>' + st.files + '</b><span>Files uploaded</span></div><div><b>' + st.links + '</b><span>Links drawn</span></div></div>' +
      '<div class="mosaic-wrap"><h3>Contribution record</h3><p class="muted" style="margin:0;">' + total + ' contributions in the last 16 weeks — every authority, citation, link and upload fills a tile.</p><div class="mosaic">' + cells + '</div><div class="m-legend">Quiet <i class="m-cell"></i><i class="m-cell l1"></i><i class="m-cell l2"></i><i class="m-cell l3"></i><i class="m-cell l4"></i> Busy</div></div>' +
      '<form class="edit-box" id="prof-form" novalidate><h3>Edit profile</h3><label class="field"><span>Full name</span><input id="pf-name" type="text" maxlength="80" value="' + esc(p.name) + '"></label><div class="field-row"><label class="field"><span>Practice area</span><select id="pf-practice">' + opts + '</select></label><label class="field"><span>City</span><input id="pf-city" type="text" maxlength="60" value="' + esc(p.city || '') + '"></label></div><div class="field-row"><label class="field"><span>Enrolled in <small>(year)</small></span><input id="pf-year" type="number" min="1950" max="' + yrs + '" value="' + esc(p.enrolYear || '') + '"></label><label class="check" style="align-self:end;margin-bottom:22px;"><input id="pf-public" type="checkbox"' + (p.public ? ' checked' : '') + '> <span>Listed in the Community</span></label></div><div style="display:flex;gap:12px;align-items:center;"><button class="a-btn sm" type="submit">Save changes</button><span class="form-msg" id="pf-msg" style="margin:0;"></span></div></form>' +
      '<form class="edit-box" id="pw-form" novalidate><h3>Change password</h3><div class="field-row"><label class="field"><span>Current password</span><input id="pw-cur" type="password" autocomplete="current-password" maxlength="200"></label><label class="field"><span>New password <small>(8+ characters)</small></span><input id="pw-new" type="password" autocomplete="new-password" maxlength="200"></label></div><div style="display:flex;gap:12px;align-items:center;"><button class="a-btn sm ghost" type="submit">Update password</button><span class="form-msg" id="pw-msg" style="margin:0;"></span></div></form>' +
      '<div class="danger"><span>Deleting your account removes your profile, email and draft. Authorities you added stay in the repository.</span><span style="display:flex;gap:10px;flex-wrap:wrap;"><button class="a-btn sm ghost" id="logout-btn" type="button">Sign out</button><button class="a-btn sm danger-btn" id="del-account" type="button">Delete account</button></span></div>';
  }
  $('#profile-body').addEventListener('submit', function (e) {
    if (e.target.id === 'pw-form') {
      e.preventDefault(); var pm = $('#pw-msg');
      if ($('#pw-new').value.length < 8) return setMsg(pm, 'New password must be at least 8 characters.', 'err');
      api('POST', '/api/auth/password', { current: $('#pw-cur').value, next: $('#pw-new').value })
        .then(function () { $('#pw-cur').value = ''; $('#pw-new').value = ''; setMsg(pm, 'Password updated.', 'ok'); toast('Password updated.'); })
        .catch(function (err) { setMsg(pm, err.message || 'Could not update the password.', 'err'); });
      return;
    }
    if (e.target.id !== 'prof-form') return; e.preventDefault();
    var msg = $('#pf-msg'), name = $('#pf-name').value.trim(), y = parseInt($('#pf-year').value, 10);
    if (name.length < 2) return setMsg(msg, 'Please enter your name.', 'err');
    var patch = { name: name, practice: $('#pf-practice').value, city: $('#pf-city').value.trim(), enrolYear: isNaN(y) ? null : y, public: $('#pf-public').checked };
    api('PATCH', '/api/profile', patch).then(function () { setMsg(msg, 'Saved.', 'ok'); toast('Profile updated.'); return load(); }).catch(function (err) { setMsg(msg, err.message || 'Could not save.', 'err'); });
  });
  $('#profile-body').addEventListener('click', function (e) {
    if (e.target.id !== 'del-account') return;
    armConfirm(e.target, function () {
      api('DELETE', '/api/account').then(function () {
        S.draftLoaded = false; $('#draft-title').value = ''; $('#draft-body').value = ''; toast('Your account has been deleted.'); return load();
      }).then(function () { location.hash = '#/'; }).catch(function () { toast('Could not delete the account. Try again.'); });
    });
  });

  /* ---------- owner inbox ---------- */
  function renderInbox() {
    var box = $('#inbox-list');
    if (!S.inbox.length) { box.innerHTML = '<div class="empty">No messages yet.</div>'; return; }
    box.innerHTML = S.inbox.map(function (m) {
      return '<div class="inbox-card"><div class="who">' + esc(m.name || 'Someone') + ' <span>' + esc(rel(m.at)) + '</span></div><div class="auth-meta"><a href="mailto:' + esc(m.email || '') + '" style="color:var(--accent);font-weight:700;">' + esc(m.email || '') + '</a></div><span class="tagline-s">' + esc(m.topic || m.type || 'Message') + '</span><p>' + esc(m.message || '') + '</p></div>';
    }).join('');
  }

  $('#mobile-menu').addEventListener('click', function (e) { if (e.target.closest('a')) { this.classList.remove('open'); $('#menu-btn').setAttribute('aria-expanded', 'false'); } });

  /* ================= go ================= */
  route();
  init();
})();
