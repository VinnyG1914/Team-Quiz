/* Player page: PIN, then nickname + character, then answer on this device. */
(function () {
  'use strict';
  var CFG = window.TQ_CONFIG, S = TQ.Sound, esc = TQ.esc;
  var PREF_KEY = 'tq_player';
  function $(id) { return document.getElementById(id); }

  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { prefs = {}; }
  function rnd(list) { return list[Math.floor(Math.random() * list.length)]; }
  var sel = TQ.cleanAvatar({ id: TQ.AVATAR_SRC[prefs.id] ? prefs.id : rnd(TQ.AVATARS), c: prefs.c || rnd(TQ.COLORS) });
  var tab = Math.max(0, TQ.AVATAR_GROUPS.findIndex(function (g) { return g.items.some(function (it) { return it.id === sel.id; }); }));

  var pin = '', pid = '', myName = '', score = 0;
  var peer = null, conn = null, joined = false, finished = false;
  var retryTimer = null, connectTimer = null, qInterval = null, lastQ = -1, answered = false;
  var resendTimer = null, confirmedQ = -1;

  function show(name) {
    document.querySelectorAll('.screen').forEach(function (el) {
      var on = el.id === 'scr-' + name;
      el.hidden = !on;
      if (on) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
    });
    document.body.setAttribute('data-screen', name);
  }
  function setBg(id) { if (id && TQ.isTheme(id)) TQ.Backdrop.set(TQ.themeURL(id)); }

  /* ---------------- Step 1: PIN ---------------- */
  $('in-pin').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
  $('in-pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') onPin(); });
  $('btn-pin').onclick = onPin;
  function onPin() {
    S.unlock();
    var p = $('in-pin').value.replace(/\D/g, '');
    if (p.length !== 6) { pinError('Enter the 6-digit Game PIN shown on the host screen.'); return; }
    pin = p;
    goProfile();
  }
  function pinError(msg) {
    var e = $('pin-err');
    e.textContent = '';
    void e.offsetWidth;
    e.textContent = msg || '';
  }
  function goPin(msg) {
    stopTimer();
    show('pin');
    pinError(msg || '');
    $('in-pin').focus();
  }
  $('btn-change-pin').onclick = function () { goPin(''); };

  /* ---------------- Step 2: nickname + character ---------------- */
  function goProfile(msg) {
    stopTimer();
    $('pin-show').textContent = pin;
    show('join');
    renderPicker(true);
    joinError(msg || '');
    if (!$('in-name').value) $('in-name').focus();
  }
  function renderPicker(full) {
    if (full) {
      $('av-tabs').innerHTML = TQ.AVATAR_GROUPS.map(function (g, i) {
        return '<button type="button" data-tab="' + i + '" class="' + (i === tab ? 'sel' : '') + '">' + esc(g.name) + '</button>';
      }).join('');
      var g = TQ.AVATAR_GROUPS[tab] || { items: [] };
      $('av-grid').innerHTML = g.items.map(function (it, k) {
        return '<button type="button" data-id="' + esc(it.id) + '" style="animation-delay:' + (k * 0.025) + 's;background:' + sel.c + '" class="' +
          (it.id === sel.id ? 'sel' : '') + '"><img alt="" draggable="false" src="' + esc(it.src) + '"></button>';
      }).join('');
      $('col-grid').innerHTML = TQ.COLORS.map(function (c) {
        return '<button type="button" data-c="' + c + '" title="Colour" style="background:' + c + '" class="' + (c === sel.c ? 'sel' : '') + '"></button>';
      }).join('');
    } else {
      $('av-grid').querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('sel', b.getAttribute('data-id') === sel.id);
        b.style.background = sel.c;
      });
      $('col-grid').querySelectorAll('button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-c') === sel.c); });
    }
    $('av-preview').innerHTML = TQ.avatarHTML(sel, 'big bounce') + '<span>' + esc($('in-name').value.trim() || 'You') + '</span>';
  }
  $('av-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) { tab = +b.getAttribute('data-tab'); renderPicker(true); }
  });
  $('av-grid').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-id]');
    if (b) { sel.id = b.getAttribute('data-id'); renderPicker(false); S.pop(); }
  });
  $('col-grid').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-c]');
    if (b) { sel.c = b.getAttribute('data-c'); renderPicker(false); }
  });
  $('in-name').addEventListener('input', function () {
    var s = $('av-preview').querySelector('span:last-child');
    if (s) s.textContent = this.value.trim() || 'You';
  });
  $('in-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') onJoin(); });
  $('btn-join').onclick = onJoin;

  function joinError(msg) {
    var e = $('join-err');
    e.textContent = '';
    void e.offsetWidth;
    e.textContent = msg || '';
    $('btn-join').disabled = false;
  }

  function onJoin() {
    S.unlock();
    var n = $('in-name').value.replace(/\s+/g, ' ').trim().slice(0, CFG.maxNameLength);
    if (!n) { joinError('Enter a nickname.'); return; }
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ name: n, id: sel.id, c: sel.c })); } catch (e) { /* ignore */ }
    myName = n; pid = playerId(pin);
    joined = false; finished = false; score = 0;
    $('btn-join').disabled = true;
    showWait('<div class="spinner"></div><div class="big">Connecting…</div>');
    connect();
  }

  function playerId(p) {
    var k = 'tq_pid_' + p, v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) { v = ''; }
    if (!v) {
      v = TQ.newId();
      try { localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    }
    return v;
  }

  /* ---------------- Connection ---------------- */
  function connect() {
    clearTimeout(retryTimer);
    if (finished) return;
    if (typeof window.Peer !== 'function') { failJoin('The quiz library did not load. Refresh the page.'); return; }
    if (!peer || peer.destroyed) {
      var pp = peer = new window.Peer(CFG.peerOptions);
      pp.on('open', function () { if (pp === peer) dial(); });
      pp.on('error', function (e) { if (pp === peer) onPeerError(e); });
      pp.on('disconnected', function () {
        if (pp !== peer || pp.destroyed || finished) return;
        setTimeout(function () { if (pp === peer && !pp.destroyed && pp.disconnected) pp.reconnect(); }, 1000);
      });
    } else if (peer.open) {
      dial();
    } else if (peer.disconnected) {
      try { peer.reconnect(); } catch (e) { peer.destroy(); peer = null; retryTimer = setTimeout(connect, 1000); }
    } else {
      retryTimer = setTimeout(connect, 1500);
    }
  }

  function dial() {
    if (finished) return;
    if (conn) { var old = conn; conn = null; try { old.close(); } catch (e) { /* ignore */ } }
    var c = conn = TQ.Link.dial(peer, CFG.peerPrefix + pin);
    var opened = false;
    clearTimeout(connectTimer);
    connectTimer = setTimeout(function () {
      if (opened || c !== conn) return;
      conn = null;
      try { c.close(); } catch (e) { /* ignore */ }
      if (!joined) failJoin('The host did not answer. Check the PIN and that the host has the lobby open, then try again.');
      else lost();
    }, 15000);
    c.on('open', function () {
      if (c !== conn) return;
      opened = true;
      clearTimeout(connectTimer);
      c.send({ t: 'join', pid: pid, name: myName, avatar: sel });
    });
    c.on('data', function (d) { if (c === conn) onMsg(d); });
    c.on('close', function () { if (c === conn) { conn = null; lost(); } });
    c.on('error', function () { if (c === conn) { conn = null; lost(); } });
  }

  function onPeerError(e) {
    var type = e && e.type;
    console.warn('[player] peer error', type, e);
    if (conn && conn.open) return;
    if (!conn && type === 'peer-unavailable') return;   // late echo of an attempt we already gave up on
    clearTimeout(connectTimer);
    var dead = conn;
    conn = null;
    try { if (dead) dead.close(); } catch (er) { /* ignore */ }
    if (type === 'peer-unavailable') {
      if (!joined) goPin('No game found with PIN ' + pin + '.\nCheck the PIN, and make sure the host has the lobby open.');
      else lost();
    } else if (type === 'browser-incompatible') {
      failJoin('This browser cannot join. Use Chrome, Edge or Firefox.');
    } else if (!joined) {
      failJoin('Could not reach the game service (' + type + '). Check your internet and try again.');
    } else {
      lost();
    }
  }

  function failJoin(msg) { goProfile(msg); }

  function lost() {
    if (finished) return;
    if (!joined) { failJoin('Connection to the host failed. Try again.'); return; }
    $('reconnect').hidden = false;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 2000);
  }

  function hangUp() {
    finished = true;
    stopTimer();
    clearTimeout(retryTimer); clearTimeout(connectTimer);
    var c = conn, p = peer;
    conn = null; peer = null;
    try { if (c) c.close(); } catch (e) { /* ignore */ }
    try { if (p) p.destroy(); } catch (e) { /* ignore */ }
    $('reconnect').hidden = true;
  }

  $('btn-leave').onclick = function () { hangUp(); goProfile(''); };

  /* ---------------- Screens ---------------- */
  function meHTML() { return TQ.avatarHTML(sel, 'sm') + '<span>' + esc(myName) + '</span>'; }
  function updateBars(fromScore) {
    ['w-me', 'q-me', 'r-me'].forEach(function (id) { $(id).innerHTML = meHTML(); });
    ['w-score', 'q-score', 'r-score'].forEach(function (id) {
      if (typeof fromScore === 'number' && fromScore !== score) TQ.countUp($(id), fromScore, score, 900);
      else $(id).textContent = TQ.fmt(score);
    });
  }
  function showWait(html, progress, title) {
    stopTimer();
    $('w-body').innerHTML = html;
    $('w-progress').textContent = progress || '';
    if (title !== undefined) $('w-title').textContent = title;
    updateBars();
    show('wait');
  }
  function progressText(d) { return (d && d.total) ? 'Question ' + (d.index + 1) + ' of ' + d.total : ''; }
  function rankHTML(d) {
    var s;
    if (d.rank === 1) s = d.count > 1 ? 'You\'re in the lead! 🏆' : 'You\'re in 1st place';
    else s = 'You\'re in ' + TQ.ordinal(d.rank) + ' place';
    if (d.behind && d.rank > 1) {
      s += '<br><small style="opacity:.85">' + (d.behind.gap > 0 ? TQ.fmt(d.behind.gap) + ' points behind ' : 'Tied on points with ') + esc(d.behind.name) + '</small>';
    }
    return '<div class="big">' + s + '</div>';
  }
  function stopTimer() { if (qInterval) clearInterval(qInterval); qInterval = null; }

  function renderReady(d) {
    setBg(d.bg);
    showWait('<div class="pill">' + (d.type === 'truefalse' ? 'True or false' : 'Quiz') + '</div>' +
      '<h1>Question ' + (d.index + 1) + '</h1>' +
      (d.text ? '<div class="card wide-only" style="padding:18px 28px;font-size:28px;font-weight:800;max-width:900px">' + esc(d.text) + '</div>' : '') +
      (d.points === 'double' ? '<div class="badge-double">⚡ Double points ⚡</div>' : '') +
      '<div class="pbar"><div id="w-pbar"></div></div><div style="opacity:.85">Get ready…</div>', progressText(d));
    var bar = $('w-pbar');
    if (bar) {
      requestAnimationFrame(function () {
        bar.style.transition = 'width ' + ((d.ms || 5000) / 1000) + 's linear';
        bar.style.width = '100%';
      });
    }
  }

  function renderQuestion(d) {
    stopTimer();
    setBg(d.bg);
    lastQ = d.index;
    answered = false;
    $('q-progress').textContent = (d.index + 1) + ' / ' + d.total + (d.points === 'double' ? ' · ⚡ x2' : '');
    $('q-text').textContent = d.text || '';
    var st = TQ.answerStyles(d.type), html = '';
    for (var j = 0; j < d.n; j++) {
      html += '<button type="button" data-j="' + j + '" style="background:' + st[j].color + '" aria-label="Answer ' + (j + 1) + '">' +
        TQ.shapeSVG(st[j].shape) + '<span class="t">' + esc(d.texts && d.texts[j] ? d.texts[j] : '') + '</span></button>';
    }
    $('q-answers').innerHTML = html;
    $('q-answers').className = 'p-answers';
    updateBars();
    show('question');
    var end = Date.now() + (d.remainingMs || 0), timer = $('q-timer');
    function tick() {
      var rem = Math.max(0, end - Date.now()), s = Math.ceil(rem / 1000);
      timer.textContent = s;
      timer.classList.toggle('low', s <= 5 && rem > 0);
      if (rem <= 0) stopTimer();
    }
    tick();
    qInterval = setInterval(tick, 200);
  }

  $('q-answers').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-j]');
    if (!b || answered || !conn || !conn.open) return;
    answered = true;
    var msg = { t: 'answer', q: lastQ, c: parseInt(b.getAttribute('data-j'), 10) };
    try { conn.send(msg); } catch (er) { answered = false; return; }
    // Resend until the host confirms, in case the message was lost while the line blipped.
    clearInterval(resendTimer);
    resendTimer = setInterval(function () {
      if (lastQ !== msg.q || confirmedQ === msg.q) { clearInterval(resendTimer); return; }
      try { if (conn && conn.open) conn.send(msg); } catch (er) { /* retry next tick */ }
    }, 2500);
    if (navigator.vibrate) navigator.vibrate(30);
    S.locked();
    b.classList.add('pick');
    $('q-answers').classList.add('chosen');
    var shown = lastQ;
    setTimeout(function () { if (lastQ === shown && document.body.getAttribute('data-screen') === 'question') showLocked(); }, 380);
  });

  function showLocked() {
    showWait('<div class="hourglass">⏳</div><h1>Answer locked in</h1><div class="big" style="opacity:.85">Were you fast enough?</div>',
      $('q-progress').textContent.replace(/ ·.*$/, ''));
  }

  function renderResult(d) {
    stopTimer();
    var from = typeof d.prevScore === 'number' ? d.prevScore : score;
    score = d.score;
    var cls, icon, head;
    if (!d.answered) { cls = 'bad'; icon = '⏰'; head = 'Time\'s up'; }
    else if (d.correct) { cls = 'ok'; icon = '✔'; head = 'Correct!'; }
    else { cls = 'bad'; icon = '✖'; head = 'Incorrect'; }
    var html = '<div class="icon">' + icon + '</div><h1>' + head + '</h1>';
    if (d.noPoints) html += '<div class="big">No points on this question</div>';
    else if (d.correct) {
      html += '<div class="pts">+ <span id="r-pts">0</span></div>';
      if (d.streak >= 2) html += '<div class="big">🔥 Answer streak ' + d.streak + (d.bonus ? ' <small>(+' + TQ.fmt(d.bonus) + ' bonus)</small>' : '') + '</div>';
    } else {
      html += '<div class="big" style="opacity:.9">' + (d.answered ? 'Answer streak lost' : 'No answer this time') + '</div>';
    }
    html += rankHTML(d);
    $('r-body').innerHTML = html;
    $('r-progress').textContent = progressText(d);
    var scr = $('scr-result');
    scr.classList.remove('ok', 'bad');
    scr.classList.add(cls);
    updateBars(from);
    show('result');
    if (d.correct && !d.noPoints) TQ.countUp($('r-pts'), 0, d.points + d.bonus, 900);
    if (d.correct) S.correct(); else S.wrong();
  }

  function renderEnd(d) {
    score = d.score;
    var medal = ['🥇', '🥈', '🥉'][d.rank - 1] || '🎉';
    showWait('<div class="medal">' + medal + '</div><h1>You finished ' + TQ.ordinal(d.rank) + ' of ' + d.count + '</h1>' +
      TQ.avatarHTML(sel, 'big') +
      '<div class="big">' + TQ.fmt(d.score) + ' points · ' + d.correct + ' of ' + d.total + ' correct</div>' +
      '<div style="opacity:.8">Thanks for playing! Look at the host\'s screen for the podium.</div>', 'Game over');
    if (d.rank <= 3) TQ.confetti(4000);
  }

  function goodbye(msg) {
    hangUp();
    showWait('<div style="font-size:70px">👋</div><div class="big">' + esc(msg) + '</div>' +
      '<button class="primary" id="btn-again">Back to start</button>');
    $('btn-again').onclick = function () { goPin(''); };
  }

  /* ---------------- Messages from the host ---------------- */
  function onMsg(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'welcome':
        joined = true;
        $('reconnect').hidden = true;
        myName = d.name; sel = TQ.cleanAvatar(d.avatar); score = d.score || 0;
        $('w-title').textContent = d.title || '';
        setBg(d.bg);
        updateBars();
        break;
      case 'lobby':
        showWait(TQ.avatarHTML(sel, 'huge') + '<h1>You\'re in!</h1><div class="big">' + esc(myName) + '</div>' +
          '<div style="opacity:.85">See yourself on the host\'s screen? The quiz starts soon.</div>');
        break;
      case 'intro':
        setBg(d.bg);
        showWait('<h1>' + esc(d.title) + '</h1><div class="big">Get ready!</div><div class="spinner"></div>', '', d.title);
        break;
      case 'ready':
        renderReady(d);
        break;
      case 'question':
        renderQuestion(d);
        break;
      case 'locked':
        answered = true;
        confirmedQ = d.index;
        clearInterval(resendTimer);
        showLocked();
        break;
      case 'result':
        renderResult(d);
        break;
      case 'standing':
        score = d.score;
        showWait(TQ.avatarHTML(sel, 'big') + rankHTML(d) + '<div class="big">' + TQ.fmt(d.score) + ' points</div>' +
          (d.streak >= 2 ? '<div class="big">🔥 Answer streak ' + d.streak + '</div>' : '') +
          '<div style="opacity:.8"><span class="dots">Next question coming up</span></div>');
        break;
      case 'end':
        renderEnd(d);
        break;
      case 'kicked':
        goodbye('The host removed you from this game.');
        break;
      case 'closed':
        goodbye('The host ended the game. Thanks for playing!');
        break;
      case 'replaced':
        goodbye('You joined from another tab, so this one has been disconnected.');
        break;
      case 'full':
        hangUp();
        failJoin('This game is full.');
        break;
    }
  }

  /* ---------------- Init ---------------- */
  TQ.Backdrop.set(TQ.themeURL(TQ.DEFAULT_THEME));
  var params = new URLSearchParams(location.search);
  var startPin = (params.get('pin') || params.get('code') || location.hash.replace('#', '')).replace(/\D/g, '').slice(0, 6);
  $('in-name').value = prefs.name || '';
  $('in-pin').value = startPin;
  if (startPin.length === 6) { pin = startPin; goProfile(''); }
  else goPin('');
  document.addEventListener('pointerdown', function () { S.unlock(); }, { once: true });
})();
