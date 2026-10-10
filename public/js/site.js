// ---------- scroll progress bar + header solidify ----------
  (function () {
    var header = document.getElementById('site-header');
    var ticking = false;
    function update() {
      var y = window.scrollY || window.pageYOffset;
      if (y > 40) header.classList.add('scrolled'); else header.classList.remove('scrolled');
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  })();

  // ---------- staggered reveal on scroll (features, checklist, stat tiles) ----------
  (function () {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function revealWithStagger(el) {
      var siblings = Array.prototype.filter.call(el.parentElement.children, function (c) { return c.classList && c.classList.contains('reveal-stagger'); });
      var pos = siblings.indexOf(el);
      el.style.transitionDelay = (pos * 160) + 'ms';
      el.classList.add('is-visible');
      // kick off the checkmark draw + count-up for this element once visible
      el.querySelectorAll('.check-draw').forEach(function (path) {
        try {
          var len = path.getTotalLength();
          path.style.strokeDasharray = len;
          path.style.strokeDashoffset = len;
          path.style.transition = 'stroke-dashoffset .9s ease ' + ((pos * 160) + 350) + 'ms';
          requestAnimationFrame(function () { requestAnimationFrame(function () { path.style.strokeDashoffset = '0'; }); });
        } catch (e) {}
      });
      el.querySelectorAll('.count-up').forEach(function (numEl) { startCountUp(numEl, pos * 160 + 200); });
    }

    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal-stagger').forEach(function (el) {
        el.classList.add('is-visible');
        el.querySelectorAll('.count-up').forEach(function (numEl) { numEl.textContent = numEl.getAttribute('data-to') + (numEl.getAttribute('data-suffix') || ''); });
      });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.15) { revealWithStagger(entry.target); }
          else if (entry.intersectionRatio < 0.1) { entry.target.style.transitionDelay = '0ms'; entry.target.classList.remove('is-visible'); }   // (almost) out of view: reset so it plays again next time
        });
      }, { threshold: [0, 0.1, 0.15] });
      document.querySelectorAll('.reveal-stagger').forEach(function (el) { io.observe(el); });
    }
  })();

  function startCountUp(el, delayMs) {
    var to = parseFloat(el.getAttribute('data-to'));
    var suffix = el.getAttribute('data-suffix') || '';
    var duration = 1800;
    setTimeout(function () {
      var start = null;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = Math.round(to * eased);
        el.textContent = val + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }, delayMs + 100);
  }

  // ---------- photo background parallax (hero + the two mid-page photo sections) ----------
  (function () {
    var layers = document.querySelectorAll('[data-parallax-bg]');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!layers.length || reduceMotion) return;
    var ticking = false;
    function update() {
      layers.forEach(function (layer) {
        var rect = layer.parentElement.getBoundingClientRect();
        var centerOffset = (rect.top + rect.height / 2) - (window.innerHeight / 2);
        var maxShift = Math.max(0, (layer.offsetHeight - layer.parentElement.offsetHeight) / 2 - 2);
        var shift = Math.max(-maxShift, Math.min(maxShift, centerOffset * -0.2));
        layer.style.transform = 'translateY(' + shift + 'px)';
      });
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  })();

  // ---------- mobile menu ----------
  var menuBtn = document.getElementById('menu-btn');
  var mobileMenu = document.getElementById('mobile-menu');
  menuBtn.addEventListener('click', function () {
    var open = mobileMenu.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mobileMenu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { mobileMenu.classList.remove('open'); });
  });

  // ---------- legal-only assistant (server-side: Claude when an API key is set, otherwise a scripted reply) ----------
  var chatTurns = [];
  var chatBusy = false;

  function addMsg(sender, text) {
    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = sender === 'user' ? 'flex-end' : 'flex-start';
    var bubble = document.createElement('div');
    bubble.style.maxWidth = '82%';
    bubble.style.padding = '9px 13px';
    bubble.style.fontSize = '13.5px';
    bubble.style.lineHeight = '1.5';
    bubble.style.borderRadius = '8px';
    bubble.style.background = sender === 'user' ? 'var(--accent)' : 'var(--paper)';
    bubble.style.color = sender === 'user' ? '#fff' : 'var(--ink)';
    bubble.style.border = sender === 'user' ? 'none' : '1px solid var(--line)';
    bubble.textContent = text;
    row.appendChild(bubble);
    document.getElementById('chat-messages').appendChild(row);
    document.getElementById('chat-messages').scrollTop = 999999;
    return bubble;
  }

  function sendChat() {
    if (chatBusy) return;
    var input = document.getElementById('chat-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    var bubble = addMsg('assistant', '');
    bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    chatBusy = true;
    document.getElementById('chat-send').style.opacity = '.5';
    chatTurns.push({ role: 'user', content: text });
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dike' },
      body: JSON.stringify({ messages: chatTurns.slice(-10) })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        var reply = res.ok ? res.j.text : (res.j.error || 'Something went wrong — try again.');
        bubble.textContent = reply;
        if (res.ok) chatTurns.push({ role: 'assistant', content: reply }); else chatTurns.pop();
      })
      .catch(function () { bubble.textContent = 'Could not reach the server — try again.'; chatTurns.pop(); })
      .then(function () {
        chatBusy = false;
        document.getElementById('chat-send').style.opacity = '1';
        document.getElementById('chat-messages').scrollTop = 999999;
      });
  }

  function toggleChat() {
    var p = document.getElementById('chat-panel');
    p.style.display = (p.style.display === 'flex') ? 'none' : 'flex';
  }
  document.getElementById('chat-toggle').addEventListener('click', toggleChat);
  document.getElementById('chat-close').addEventListener('click', toggleChat);
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });
