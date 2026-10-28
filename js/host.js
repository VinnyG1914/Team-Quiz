/* Host page: quiz library, editor, and the game itself (the host's browser is the game server). */
(function () {
  'use strict';
  var CFG = window.TQ_CONFIG, S = TQ.Sound, esc = TQ.esc;
  var SETTINGS_KEY = 'tq_settings', ACTIVE_KEY = 'tq_active';
  var GAME_SCREENS = ['intro', 'preview', 'question', 'reveal', 'scoreboard'];
  var RING_C = 2 * Math.PI * 52;
  var SB_ROW = 82;
  function $(id) { return document.getElementById(id); }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }

  var game = null, peer = null, ed = null;

  function show(name) {
    document.querySelectorAll('.screen').forEach(function (el) {
      var on = el.id === 'scr-' + name;
      if (on && el.hidden) { el.hidden = false; el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
      else if (!on) el.hidden = true;
    });
    document.body.setAttribute('data-screen', name);
    $('btn-end').hidden = !(game && GAME_SCREENS.indexOf(name) >= 0);
    $('net').hidden = !game;
    TQ.Backdrop.calm(name === 'library' || name === 'editor');
    window.scrollTo(0, 0);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function coverURL(q) {
    if (q.theme === 'custom' && q.themeImage) return q.themeImage;
    return TQ.themeThumb(TQ.themeIdFor(q, 0));
  }

  /* =====================================================================
   * LIBRARY
   * ===================================================================== */
  function renderLibrary() {
    TQ.Backdrop.set(TQ.themeURL(TQ.DEFAULT_THEME));
    show('library');
    renderResumeBanner();
    TQ.Store.persistent().then(function (ok) { $('storage-warn').hidden = ok; });
    return TQ.Store.all().then(function (list) {
      var el = $('quiz-list');
      if (!list.length) {
        el.innerHTML = '<div class="empty glass" style="grid-column:1/-1">No quizzes yet.<br>Paste one from Claude, import a file, or add the sample quiz to try it out.</div>';
        return;
      }
      el.innerHTML = list.map(function (q, k) {
        var imgs = q.questions.filter(function (x) { return x.image; }).length;
        var tf = q.questions.filter(function (x) { return x.type === 'truefalse'; }).length;
        var secs = q.questions.reduce(function (s, x) { return s + x.time + CFG.previewSeconds + 15; }, 0);
        return '<div class="card quiz-card" data-id="' + esc(q.id) + '" style="animation-delay:' + (k * 0.05) + 's">' +
          '<div class="cover" style="background-image:url(&quot;' + esc(coverURL(q)).replace(/\(/g, '%28').replace(/\)/g, '%29') + '&quot;)">' +
          '<span class="count">' + q.questions.length + ' questions</span></div>' +
          '<div class="body"><div class="title">' + esc(q.title) + '</div>' +
          '<div class="meta">' + (tf ? tf + ' true/false · ' : '') + (imgs ? imgs + ' with images · ' : '') +
          'about ' + Math.max(1, Math.round(secs / 60)) + ' min</div>' +
          '<div class="acts"><button class="go" data-act="play">▶ Host</button>' +
          '<button data-act="edit" title="Edit">✏️</button>' +
          '<button data-act="export" title="Download as a file (backup or share)">⬇</button>' +
          '<button data-act="delete" title="Delete">🗑</button></div></div></div>';
      }).join('');
    });
  }

  $('quiz-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.closest('.quiz-card').getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    TQ.Store.get(id).then(function (quiz) {
      if (!quiz) return;
      if (act === 'play') startHosting(quiz, null);
      else if (act === 'edit') openEditor(quiz);
      else if (act === 'export') TQ.download(TQ.safeFileName(quiz.title) + '.json', JSON.stringify(TQ.exportQuiz(quiz), null, 2));
      else if (act === 'delete' && confirm('Delete "' + quiz.title + '"? This cannot be undone.')) {
        TQ.Store.del(id).then(renderLibrary);
      }
    });
  });

  function saveImported(r) {
    return TQ.Store.put(r.quiz).then(function () {
      renderLibrary();
      var msg = 'Imported "' + r.quiz.title + '" with ' + r.quiz.questions.length + ' questions.';
      if (r.warnings.length) msg += '\n' + r.warnings.join('\n');
      TQ.toast(msg, r.warnings.length ? 9000 : 3500);
    }, function (e) { alert('Could not save the quiz: ' + (e && e.message ? e.message : e)); });
  }

  $('btn-new').onclick = function () {
    openEditor({ id: TQ.newId(), title: '', theme: TQ.DEFAULT_THEME, themeImage: '', questions: [blankQ('quiz')] });
  };
  $('btn-sample').onclick = function () { saveImported(TQ.normalizeQuiz(TQ.SAMPLE_QUIZ)); };
  $('btn-import').onclick = function () { $('file-import').click(); };
  $('file-import').onchange = function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try { saveImported(TQ.importText(fr.result, f.name)); }
      catch (e) { alert('Could not import "' + f.name + '":\n' + e.message); }
    };
    fr.readAsText(f);
  };
  $('btn-paste').onclick = function () {
    $('paste-text').value = '';
    $('paste-err').textContent = '';
    $('dlg-paste').showModal();
    $('paste-text').focus();
  };
  $('paste-cancel').onclick = function () { $('dlg-paste').close(); };
  $('paste-ok').onclick = function () {
    var r;
    try { r = TQ.importText($('paste-text').value, ''); }
    catch (e) { $('paste-err').textContent = e.message; return; }
    $('dlg-paste').close();
    saveImported(r);
  };
  $('btn-prompt').onclick = function () {
    $('prompt-text').value = TQ.CLAUDE_PROMPT;
    $('dlg-prompt').showModal();
  };
  $('prompt-close').onclick = function () { $('dlg-prompt').close(); };
  $('prompt-copy').onclick = function () {
    copyText(TQ.CLAUDE_PROMPT).then(function (ok) {
      if (ok) { TQ.toast('Prompt copied. Paste it into Claude.'); $('dlg-prompt').close(); }
      else { $('prompt-text').select(); TQ.toast('Press Ctrl+C to copy.'); }
    });
  };

  /* =====================================================================
   * EDITOR
   * ===================================================================== */
  function blankQ(type) {
    if (type === 'truefalse') return { type: 'truefalse', question: '', answers: ['True', 'False'], correct: [0], time: 10, points: 'standard', image: '' };
    return { type: 'quiz', question: '', answers: ['', '', '', ''], correct: [0], time: 20, points: 'standard', image: '' };
  }

  function openEditor(quiz) {
    var copy = JSON.parse(JSON.stringify(quiz));
    if (!copy.theme) copy.theme = TQ.DEFAULT_THEME;
    ed = { quiz: copy, dirty: false, active: 0, errors: {} };
    $('ed-title').value = ed.quiz.title;
    renderThemes();
    renderEditor();
    show('editor');
  }

  function renderThemes() {
    var q = ed.quiz;
    var html = TQ.THEMES.map(function (t) {
      return '<div class="theme' + (q.theme === t.id ? ' sel' : '') + '" data-theme="' + t.id + '" style="background-image:url(&quot;' +
        TQ.themeThumb(t.id) + '&quot;)"><span>' + esc(t.name) + '</span></div>';
    }).join('');
    html += '<div class="theme rotate' + (q.theme === 'rotate' ? ' sel' : '') + '" data-theme="rotate"><span>Change every question</span></div>';
    if (q.themeImage) {
      html += '<div class="theme' + (q.theme === 'custom' ? ' sel' : '') + '" data-theme="custom" style="background-image:url(&quot;' +
        esc(q.themeImage) + '&quot;)"><span>Your picture</span></div>';
    }
    html += '<div class="theme upload" data-theme="upload"><span>⬆ Use your own picture</span></div>';
    $('ed-themes').innerHTML = html;
    TQ.Backdrop.set(q.theme === 'custom' && q.themeImage ? q.themeImage : TQ.themeURL(TQ.themeIdFor(q, 0)));
  }

  $('ed-themes').addEventListener('click', function (e) {
    var t = e.target.closest('[data-theme]');
    if (!t || !ed) return;
    var id = t.getAttribute('data-theme');
    if (id === 'upload') {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = function () {
        if (!inp.files[0]) return;
        TQ.imageToDataURL(inp.files[0], 1920, 0.8).then(function (url) {
          ed.quiz.themeImage = url; ed.quiz.theme = 'custom'; ed.dirty = true;
          renderThemes();
        }, function (err) { alert(err.message); });
      };
      inp.click();
      return;
    }
    ed.quiz.theme = id;
    ed.dirty = true;
    renderThemes();
  });

  function renderEditor() {
    var timeSet = TQ.TIMES.slice();
    $('ed-list').innerHTML = ed.quiz.questions.map(function (q, i) {
      var st = TQ.answerStyles(q.type);
      var times = timeSet.indexOf(q.time) < 0 ? timeSet.concat([q.time]).sort(function (a, b) { return a - b; }) : timeSet;
      var tf = q.type === 'truefalse';
      var answers = q.answers.map(function (a, j) {
        var isC = q.correct.indexOf(j) >= 0;
        return '<div class="ans-edit" style="background:' + st[j].color + '">' + TQ.shapeSVG(st[j].shape) +
          '<input type="text" data-f="ans" data-j="' + j + '" maxlength="120" value="' + esc(a) + '" placeholder="Answer ' + (j + 1) +
          (j >= 2 ? ' (optional)' : '') + '"' + (tf ? ' readonly' : '') + '>' +
          '<label><input type="' + (tf ? 'radio' : 'checkbox') + '" name="corr' + i + '" data-f="corr" data-j="' + j + '"' + (isC ? ' checked' : '') + '> correct</label>' +
          (!tf && q.answers.length > 2 ? '<button class="rm" data-act="rm-ans" data-j="' + j + '" title="Remove this answer">✕</button>' : '') +
          '</div>';
      }).join('');
      var err = ed.errors[i];
      return '<div class="card q-card' + (err ? ' error' : '') + '" data-i="' + i + '">' +
        '<div class="q-head"><span class="q-num">' + (i + 1) + '</span>' +
        '<select data-f="type"><option value="quiz"' + (tf ? '' : ' selected') + '>Quiz</option><option value="truefalse"' + (tf ? ' selected' : '') + '>True / False</option></select>' +
        '<select data-f="time">' + times.map(function (t) { return '<option value="' + t + '"' + (t === q.time ? ' selected' : '') + '>' + t + ' sec</option>'; }).join('') + '</select>' +
        '<select data-f="points">' + [['standard', 'Standard points'], ['double', 'Double points'], ['none', 'No points']].map(function (p) {
          return '<option value="' + p[0] + '"' + (q.points === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
        }).join('') + '</select>' +
        '<span class="spacer"></span>' +
        '<button data-act="up" title="Move up">↑</button><button data-act="down" title="Move down">↓</button>' +
        '<button data-act="dup" title="Duplicate">⧉</button><button data-act="del" title="Delete question">🗑</button></div>' +
        '<textarea data-f="question" maxlength="300" placeholder="Type your question">' + esc(q.question) + '</textarea>' +
        '<div class="q-img" data-act="img" tabindex="0">' +
        (q.image ? '<img alt="" src="' + esc(q.image) + '"><button class="small" data-act="img-rm">Remove image</button>'
          : '🖼 Click, paste (Ctrl+V) or drop an image here (optional)') + '</div>' +
        '<div class="q-answers">' + answers + '</div>' +
        (!tf && q.answers.length < 4 ? '<div class="row" style="margin-top:10px"><button class="small" data-act="add-ans">+ Add answer</button></div>' : '') +
        (err ? '<div class="err-text">⚠ ' + esc(err) + '</div>' : '') +
        '</div>';
    }).join('') || '<div class="empty glass">No questions. Add one below.</div>';
  }

  function cardIndex(el) {
    var c = el.closest('.q-card');
    return c ? parseInt(c.getAttribute('data-i'), 10) : -1;
  }

  var edList = $('ed-list');
  edList.addEventListener('input', function (e) {
    var i = cardIndex(e.target), f = e.target.getAttribute('data-f');
    if (i < 0) return;
    var q = ed.quiz.questions[i];
    if (f === 'question') q.question = e.target.value;
    else if (f === 'ans' && q.type === 'quiz') q.answers[+e.target.getAttribute('data-j')] = e.target.value;
    ed.dirty = true;
  });
  edList.addEventListener('change', function (e) {
    var i = cardIndex(e.target), f = e.target.getAttribute('data-f');
    if (i < 0) return;
    var q = ed.quiz.questions[i];
    ed.dirty = true;
    if (f === 'type') {
      var fresh = blankQ(e.target.value);
      fresh.question = q.question; fresh.image = q.image; fresh.points = q.points;
      ed.quiz.questions[i] = fresh;
      renderEditor();
    } else if (f === 'time') q.time = parseInt(e.target.value, 10);
    else if (f === 'points') q.points = e.target.value;
    else if (f === 'corr') {
      var j = +e.target.getAttribute('data-j');
      if (q.type === 'truefalse') q.correct = [j];
      else {
        q.correct = q.correct.filter(function (x) { return x !== j; });
        if (e.target.checked) q.correct.push(j);
        q.correct.sort();
      }
    }
  });
  edList.addEventListener('focusin', function (e) {
    var i = cardIndex(e.target);
    if (i >= 0) ed.active = i;
  });
  edList.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var i = cardIndex(el), qs = ed.quiz.questions, q = qs[i], act = el.getAttribute('data-act');
    if (i < 0) return;
    ed.active = i;
    if (act === 'img') { pickImage(i); return; }
    e.stopPropagation();
    ed.dirty = true;
    if (act === 'up' && i > 0) { qs.splice(i - 1, 0, qs.splice(i, 1)[0]); }
    else if (act === 'down' && i < qs.length - 1) { qs.splice(i + 1, 0, qs.splice(i, 1)[0]); }
    else if (act === 'dup') { qs.splice(i + 1, 0, JSON.parse(JSON.stringify(q))); }
    else if (act === 'del') { if (!confirm('Delete question ' + (i + 1) + '?')) return; qs.splice(i, 1); }
    else if (act === 'img-rm') { q.image = ''; }
    else if (act === 'add-ans') { q.answers.push(''); }
    else if (act === 'rm-ans') {
      var j = +el.getAttribute('data-j');
      q.answers.splice(j, 1);
      q.correct = q.correct.filter(function (x) { return x !== j; }).map(function (x) { return x > j ? x - 1 : x; });
    } else return;
    ed.errors = {};
    renderEditor();
  });
  edList.addEventListener('dragover', function (e) {
    var box = e.target.closest('.q-img');
    if (box) { e.preventDefault(); box.classList.add('over'); }
  });
  edList.addEventListener('dragleave', function (e) {
    var box = e.target.closest('.q-img');
    if (box) box.classList.remove('over');
  });
  edList.addEventListener('drop', function (e) {
    var box = e.target.closest('.q-img');
    if (!box) return;
    e.preventDefault();
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setImage(cardIndex(box), f);
  });
  document.addEventListener('paste', function (e) {
    if (!ed || $('scr-editor').hidden) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var k = 0; k < items.length; k++) {
      if (items[k].kind === 'file' && /^image\//.test(items[k].type)) {
        e.preventDefault();
        setImage(ed.active, items[k].getAsFile());
        return;
      }
    }
  });

  function pickImage(i) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function () { if (inp.files[0]) setImage(i, inp.files[0]); };
    inp.click();
  }
  function setImage(i, file) {
    if (!ed.quiz.questions[i]) return;
    TQ.imageToDataURL(file, 1280).then(function (url) {
      ed.quiz.questions[i].image = url;
      ed.dirty = true;
      renderEditor();
      TQ.toast('Image added to question ' + (i + 1) + '.');
    }, function (err) { alert(err.message); });
  }

  $('ed-title').addEventListener('input', function () { ed.dirty = true; });
  $('ed-add-quiz').onclick = function () { addQuestion('quiz'); };
  $('ed-add-tf').onclick = function () { addQuestion('truefalse'); };
  function addQuestion(type) {
    ed.quiz.questions.push(blankQ(type));
    ed.dirty = true;
    renderEditor();
    var cards = edList.querySelectorAll('.q-card');
    var last = cards[cards.length - 1];
    if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); last.querySelector('textarea').focus(); }
  }

  function cleanForSave() {
    var errors = {}, out = [];
    ed.quiz.questions.forEach(function (q, i) {
      var c = JSON.parse(JSON.stringify(q)), err = '';
      c.question = String(c.question || '').trim();
      if (!c.question) err = 'Write the question text.';
      if (c.type === 'quiz') {
        var keep = [], corr = [];
        c.answers.forEach(function (a, j) {
          a = String(a || '').trim();
          var isC = c.correct.indexOf(j) >= 0;
          if (a) { if (isC) corr.push(keep.length); keep.push(a); }
          else if (isC && !err) err = 'A correct tick is on an empty answer.';
        });
        if (!err && keep.length < 2) err = 'Add at least 2 answers.';
        if (!err && !corr.length) err = 'Tick the correct answer.';
        c.answers = keep; c.correct = corr;
      } else if (!c.correct.length) err = 'Choose True or False as the correct answer.';
      if (err) errors[i] = err;
      out.push(c);
    });
    return { errors: errors, questions: out };
  }

  function saveEditor() {
    var r = cleanForSave();
    ed.errors = r.errors;
    if (!ed.quiz.questions.length) { alert('Add at least one question.'); return Promise.resolve(false); }
    var bad = Object.keys(r.errors);
    if (bad.length) {
      renderEditor();
      var first = edList.querySelector('.q-card.error');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      TQ.toast('Fix ' + bad.length + ' question' + (bad.length > 1 ? 's' : '') + ' marked in red before saving.');
      return Promise.resolve(false);
    }
    var quiz = { id: ed.quiz.id, title: $('ed-title').value.trim() || 'Untitled quiz', theme: ed.quiz.theme,
      themeImage: ed.quiz.theme === 'custom' ? ed.quiz.themeImage : '', questions: r.questions };
    return TQ.Store.put(quiz).then(function () {
      ed.dirty = false;
      renderEditor();
      TQ.toast('Saved "' + quiz.title + '".');
      return true;
    }, function (e) { alert('Could not save: ' + (e && e.message ? e.message : e)); return false; });
  }
  $('ed-save').onclick = saveEditor;
  $('ed-save2').onclick = saveEditor;
  $('ed-back').onclick = function () {
    if (ed.dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    ed = null;
    renderLibrary();
  };

  /* =====================================================================
   * GAME
   * ===================================================================== */
  function loadSettings() {
    var d = { streak: true, music: true };
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      Object.keys(d).forEach(function (k) { if (typeof s[k] === 'boolean') d[k] = s[k]; });
    } catch (e) { /* ignore */ }
    return d;
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(game.settings)); } catch (e) { /* ignore */ } }
  function makeCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
  function total() { return game.quiz.questions.length; }
  function curQ() { return game.quiz.questions[game.qIndex]; }
  function ranked() {
    return values(game.players).sort(function (a, b) { return b.score - a.score || a.joinedAt - b.joinedAt; });
  }
  function clearTimers() {
    if (!game) return;
    clearTimeout(game.timer); clearInterval(game.interval);
    if (game.raf) cancelAnimationFrame(game.raf);
    game.timers.forEach(clearTimeout);
    game.timer = null; game.interval = null; game.raf = 0; game.timers = [];
  }
  function later(fn, ms) { game.timers.push(setTimeout(fn, ms)); }
  /* Folder the site lives in. Works for /host.html and for Netlify's short /host address. */
  function joinBase() {
    return new URL('.', location.href).href;
  }
  function setNet(text, cls) {
    var n = $('net');
    n.textContent = text;
    n.className = 'net ' + (cls || '');
  }
  function bgId(i) { return TQ.themeIdFor(game.quiz, i); }
  function setBackdrop(i) { TQ.Backdrop.set(TQ.themeImageFor(game.quiz, i)); }

  function startHosting(quiz, saved) {
    S.unlock();
    if (game) endHosting(true);
    game = {
      quiz: quiz, code: saved ? saved.code : makeCode(), phase: 'lobby', qIndex: -1,
      nextIndex: saved ? saved.nextIndex : 0, started: saved ? saved.nextIndex > 0 : false,
      players: {}, banned: saved ? (saved.banned || {}) : {}, settings: loadSettings(),
      answers: {}, qStart: 0, limit: 0, timer: null, interval: null, raf: 0, timers: [],
      resumed: !!saved, netReady: false
    };
    if (saved) {
      saved.players.forEach(function (p) {
        game.players[p.pid] = { pid: p.pid, name: p.name, avatar: TQ.cleanAvatar(p.avatar), score: p.score || 0, prevScore: p.score || 0,
          streak: p.streak || 0, correctCount: p.correctCount || 0, history: p.history || [], joinedAt: p.joinedAt || Date.now(),
          conn: null, connected: false };
      });
    }
    $('players').innerHTML = '';
    setBackdrop(game.nextIndex);
    renderLobby();
    show('lobby');
    if (game.settings.music) S.music('lobby');
    openPeer(0);
    saveState();
  }

  function openPeer(attempt) {
    if (!game) return;
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } }
    game.netReady = false;
    setNet('Opening room…', '');
    renderLobby();
    if (typeof window.Peer !== 'function') { setNet('PeerJS failed to load', 'bad'); return; }
    var p = peer = new window.Peer(CFG.peerPrefix + game.code, CFG.peerOptions);
    p.on('open', function () {
      if (p !== peer) return;
      game.netReady = true;
      setNet('Room open', 'ok');
      renderLobby();
    });
    TQ.Link.listen(p, function (conn) { if (p === peer) onConnection(conn); });
    p.on('connection', function (conn) { if (p === peer) onConnection(conn); });   // players still on the old cached page
    p.on('disconnected', function () {
      if (p !== peer || p.destroyed) return;
      setNet('Reconnecting…', 'bad');
      setTimeout(function () { if (p === peer && !p.destroyed && p.disconnected) p.reconnect(); }, 1500);
    });
    p.on('error', function (err) {
      if (p !== peer || !game) return;
      var type = err && err.type;
      console.warn('[host] peer error', type, err);
      if (type === 'unavailable-id') {
        if (game.resumed && attempt < 25) {
          setNet('Reclaiming PIN ' + game.code + '… (' + (attempt + 1) + ')', 'bad');
          setTimeout(function () { if (game && peer === p) openPeer(attempt + 1); }, 3000);
        } else {
          if (game.resumed) TQ.toast('The old PIN could not be reclaimed. Send players the new PIN.', 8000);
          game.resumed = false;
          game.code = makeCode();
          openPeer(0);
        }
      } else if (type === 'peer-unavailable') {
        /* a player's page has gone away; TQ.Link already closed that connection */
      } else if (type === 'browser-incompatible') {
        setNet('Browser not supported', 'bad');
        alert('This browser does not support the connections the quiz needs. Use Chrome, Edge or Firefox.');
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(type) >= 0) {
        setNet('No connection to the game service. Retrying…', 'bad');
        setTimeout(function () {
          if (!game || p !== peer || p.destroyed) return;
          if (!game.netReady) openPeer(attempt + 1);
          else if (p.disconnected) p.reconnect();
        }, 4000);
      } else {
        setNet('Connection problem: ' + type, 'bad');
      }
    });
  }

  function onConnection(conn) {
    conn.on('data', function (d) {
      try { onData(conn, d); } catch (e) { console.error('[host] bad message', e); }
    });
    conn.on('close', function () { onClose(conn); });
    conn.on('error', function () { onClose(conn); });
  }

  function onClose(conn) {
    if (!game) return;
    var p = game.players[conn.__pid];
    if (p && p.conn === conn) {
      p.conn = null; p.connected = false;
      if (game.phase === 'lobby') renderPlayers();
      if (game.phase === 'question') { updateAnsweredCount(); maybeAllAnswered(); }
    }
  }

  function send(p, msg) {
    if (p && p.conn && p.conn.open) {
      try { p.conn.send(msg); } catch (e) { console.warn('[host] send failed', e); }
    }
  }
  function broadcast(fn) { values(game.players).forEach(function (p) { send(p, fn(p)); }); }

  function onData(conn, d) {
    if (!game || !d || typeof d !== 'object') return;
    if (d.t === 'join') { handleJoin(conn, d); return; }
    var p = game.players[conn.__pid];
    if (!p || p.conn !== conn) return;
    if (d.t === 'answer') handleAnswer(p, d);
  }

  function cleanName(n) {
    var s = String(n || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, CFG.maxNameLength);
    return s || 'Player';
  }
  function uniqueName(name, pid) {
    var taken = {};
    values(game.players).forEach(function (p) { if (p.pid !== pid) taken[p.name.toLowerCase()] = 1; });
    if (!taken[name.toLowerCase()]) return name;
    for (var k = 2; k < 100; k++) {
      var cand = name.slice(0, CFG.maxNameLength - 2) + ' ' + k;
      if (!taken[cand.toLowerCase()]) return cand;
    }
    return name;
  }

  function handleJoin(conn, d) {
    var pid = String(d.pid || '').slice(0, 40);
    if (!pid) return;
    if (game.banned[pid]) {
      try { conn.send({ t: 'kicked' }); } catch (e) { /* ignore */ }
      setTimeout(function () { try { conn.close(); } catch (e) { /* ignore */ } }, 500);
      return;
    }
    var p = game.players[pid];
    if (p) {
      if (p.conn && p.conn !== conn) {
        var old = p.conn;
        old.__pid = null;
        try { old.send({ t: 'replaced' }); old.close(); } catch (e) { /* ignore */ }
      }
      p.conn = conn; p.connected = true;
      if (game.phase === 'lobby') { p.name = uniqueName(cleanName(d.name), pid); p.avatar = TQ.cleanAvatar(d.avatar); }
    } else {
      if (values(game.players).length >= CFG.maxPlayers) {
        try { conn.send({ t: 'full' }); } catch (e) { /* ignore */ }
        return;
      }
      p = game.players[pid] = {
        pid: pid, name: uniqueName(cleanName(d.name), pid), avatar: TQ.cleanAvatar(d.avatar),
        score: 0, prevScore: 0, streak: 0, correctCount: 0, history: [], joinedAt: Date.now(), conn: conn, connected: true
      };
      if (game.phase === 'lobby') S.pop();
      else TQ.toast(p.name + ' joined the game.');
    }
    conn.__pid = pid;
    syncPlayer(p);
    if (game.phase === 'lobby') renderPlayers();
    if (game.phase === 'question') updateAnsweredCount();
    saveState();
  }

  function introMsg() { return { t: 'intro', title: game.quiz.title, total: total(), bg: bgId(game.nextIndex) }; }
  function readyMsg() {
    var q = curQ();
    return { t: 'ready', index: game.qIndex, total: total(), type: q.type, points: q.points, text: q.question,
      ms: CFG.previewSeconds * 1000, bg: bgId(game.qIndex) };
  }
  function questionMsg() {
    var q = curQ();
    return { t: 'question', index: game.qIndex, total: total(), type: q.type, n: q.answers.length, points: q.points,
      remainingMs: Math.max(0, game.limit - (Date.now() - game.qStart)), limitMs: game.limit,
      text: q.question, texts: q.answers, bg: bgId(game.qIndex) };
  }
  function standingMsg(p) {
    var r = ranked(), i = r.indexOf(p), ahead = i > 0 ? r[i - 1] : null;
    return { t: 'standing', rank: i + 1, count: r.length, score: p.score, streak: p.streak,
      behind: ahead ? { name: ahead.name, gap: ahead.score - p.score } : null };
  }
  function endMsg(p) {
    var r = ranked();
    return { t: 'end', rank: r.indexOf(p) + 1, count: r.length, score: p.score, correct: p.correctCount || 0, total: total() };
  }

  function syncPlayer(p) {
    send(p, { t: 'welcome', name: p.name, avatar: p.avatar, score: p.score, title: game.quiz.title,
      bg: bgId(Math.max(0, game.qIndex >= 0 ? game.qIndex : game.nextIndex)) });
    var ph = game.phase;
    if (ph === 'lobby') send(p, { t: 'lobby' });
    else if (ph === 'intro') send(p, introMsg());
    else if (ph === 'preview') send(p, readyMsg());
    else if (ph === 'question') send(p, game.answers[p.pid] ? { t: 'locked', index: game.qIndex, total: total() } : questionMsg());
    else if (ph === 'reveal') send(p, (p.lastResult && p.lastResult.index === game.qIndex) ? p.lastResult : standingMsg(p));
    else if (ph === 'scoreboard') send(p, standingMsg(p));
    else if (ph === 'end') send(p, endMsg(p));
  }

  /* ---------- Lobby ---------- */
  function renderLobby() {
    if (!game) return;
    $('lobby-title').textContent = game.quiz.title + (game.started ? ' · continues at question ' + (game.nextIndex + 1) : '');
    $('join-code').textContent = game.netReady ? game.code : '······';
    $('join-url').textContent = joinBase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (location.protocol === 'file:') {
      $('join-url').innerHTML = esc(joinBase()) + '<div class="err-text">This page is opened from your laptop, so others cannot reach it. Use your Netlify link.</div>';
    }
    $('set-streak').checked = game.settings.streak;
    $('set-music').checked = game.settings.music;
    $('btn-start').textContent = game.started ? 'Continue' : 'Start';
    renderPlayers();
  }

  function renderPlayers() {
    if (!game) return;
    var box = $('players');
    var list = values(game.players).sort(function (a, b) { return a.joinedAt - b.joinedAt; });
    var seen = {};
    list.forEach(function (p) {
      seen[p.pid] = 1;
      var el = box.querySelector('[data-pid="' + CSS.escape(p.pid) + '"]');
      var html = TQ.avatarHTML(p.avatar) + '<span>' + esc(p.name) + '</span>';
      if (!el) {
        el = document.createElement('div');
        el.setAttribute('data-pid', p.pid);
        el.title = 'Click to remove';
        box.appendChild(el);
      }
      if (el.getAttribute('data-html') !== html) { el.innerHTML = html; el.setAttribute('data-html', html); }
      el.className = 'player-chip' + (p.connected ? '' : ' off');
    });
    box.querySelectorAll('[data-pid]').forEach(function (el) { if (!seen[el.getAttribute('data-pid')]) el.remove(); });
    var online = list.filter(function (p) { return p.connected; }).length;
    $('player-count').textContent = online;
    $('lobby-wait').innerHTML = list.length ? '<small style="opacity:.75">Click a player to remove them.</small>'
      : '<span class="dots">Waiting for players</span>';
    $('btn-start').disabled = !game.netReady;
    $('btn-start').classList.toggle('ready', game.netReady && online > 0);
  }

  $('players').addEventListener('click', function (e) {
    var el = e.target.closest('[data-pid]');
    if (!el || !game) return;
    var p = game.players[el.getAttribute('data-pid')];
    if (!p || !confirm('Remove ' + p.name + ' from the game?')) return;
    game.banned[p.pid] = true;
    send(p, { t: 'kicked' });
    var c = p.conn;
    setTimeout(function () { try { if (c) c.close(); } catch (er) { /* ignore */ } }, 400);
    delete game.players[p.pid];
    renderPlayers();
    saveState();
  });

  ['streak', 'music'].forEach(function (k) {
    $('set-' + k).addEventListener('change', function () {
      if (!game) return;
      game.settings[k] = this.checked;
      saveSettings();
      if (k === 'music') { if (this.checked) S.music('lobby'); else S.stopMusic(); }
    });
  });

  $('btn-copy-invite').onclick = function () {
    if (!game) return;
    var link = joinBase() + '?pin=' + game.code;
    copyText('Join the quiz! Open ' + link + ' (Game PIN: ' + game.code + ')').then(function (ok) {
      TQ.toast(ok ? 'Invite copied. Paste it in the Zoom chat.' : 'Copy failed. Link: ' + link, ok ? 3000 : 9000);
    });
  };
  $('btn-start').onclick = startGame;
  $('lobby-back').onclick = function () {
    if (game && game.started && !confirm('Leave this game? Players will be disconnected.')) return;
    endHosting();
  };

  /* ---------- Rounds ---------- */
  function startGame() {
    if (!game) return;
    var online = values(game.players).filter(function (p) { return p.connected; }).length;
    if (!online && !confirm('Nobody has joined yet. Start anyway?')) return;
    S.unlock();
    S.stopMusic();
    game.started = true;
    showIntro();
  }

  function showIntro() {
    clearTimers();
    game.phase = 'intro';
    var n = values(game.players).length;
    $('in-title').textContent = game.quiz.title;
    $('in-sub').textContent = (game.nextIndex > 0 ? 'Back to question ' + (game.nextIndex + 1) + ' of ' : '') +
      (game.nextIndex > 0 ? total() : total() + ' questions') + ' · ' + n + ' player' + (n === 1 ? '' : 's') + ' · Get ready!';
    setBackdrop(game.nextIndex);
    show('intro');
    broadcast(introMsg);
    var el = $('in-count');
    [3, 2, 1].forEach(function (k, i) {
      later(function () {
        el.textContent = k;
        el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        S.drum();
      }, i * 1000);
    });
    later(nextQuestion, 3200);
  }

  function nextQuestion() {
    clearTimers();
    if (game.nextIndex >= total()) { showPodium(); return; }
    game.qIndex = game.nextIndex;
    game.phase = 'preview';
    game.answers = {};
    var q = curQ();
    $('pv-progress').textContent = 'Question ' + (game.qIndex + 1) + ' of ' + total() + (q.type === 'truefalse' ? ' · True or false' : '');
    $('pv-title').textContent = q.question;
    $('pv-double').hidden = q.points !== 'double';
    setBackdrop(game.qIndex);
    show('preview');
    broadcast(readyMsg);
    S.pop();
    var bar = $('pv-bar');
    bar.style.transition = 'none';
    bar.style.width = '0';
    void bar.offsetWidth;
    bar.style.transition = 'width ' + CFG.previewSeconds + 's linear';
    bar.style.width = '100%';
    game.timer = setTimeout(beginAnswering, CFG.previewSeconds * 1000);
    saveState();
  }

  function tilesHTML(q, reveal) {
    var st = TQ.answerStyles(q.type);
    return q.answers.map(function (a, j) {
      var ok = q.correct.indexOf(j) >= 0;
      return '<div class="tile' + (reveal ? (ok ? ' win' : ' lose') : '') + '" style="background:' + st[j].color + '">' +
        '<span class="ico">' + TQ.shapeSVG(st[j].shape) + '</span><span class="txt">' + esc(a) + '</span>' +
        (reveal ? '<span class="mark">' + (ok ? '✔' : '✖') + '</span>' : '') + '</div>';
    }).join('');
  }

  function beginAnswering() {
    if (!game || game.phase !== 'preview') return;
    clearTimers();
    var q = curQ();
    game.phase = 'question';
    game.answers = {};
    game.limit = q.time * 1000;
    game.qStart = Date.now();
    $('qs-title').textContent = q.question;
    $('qs-image').innerHTML = q.image ? '<img alt="" src="' + esc(q.image) + '">'
      : '<div class="noimg">' + (q.type === 'truefalse' ? '⚖️' : '❓') + '</div>';
    $('qs-tiles').innerHTML = tilesHTML(q, false);
    var bar = $('qs-ring-bar');
    bar.style.strokeDasharray = RING_C;
    bar.style.strokeDashoffset = 0;
    $('qs-ring').classList.remove('low');
    $('qs-count').textContent = '0';
    show('question');
    broadcast(questionMsg);
    if (game.settings.music) S.music('question');
    var lastSec = -1;
    function tick() {
      if (!game || game.phase !== 'question') return;
      var rem = game.limit - (Date.now() - game.qStart);
      var s = Math.max(0, Math.ceil(rem / 1000));
      if (s !== lastSec) {
        $('qs-timer').textContent = s;
        $('qs-ring').classList.toggle('low', s <= 5);
        if (s <= 5 && s > 0) S.tick();
        lastSec = s;
      }
      if (rem <= 0) endQuestion();
    }
    function frame() {
      if (!game || game.phase !== 'question') return;
      var k = Math.min(1, (Date.now() - game.qStart) / game.limit);
      bar.style.strokeDashoffset = (RING_C * k).toFixed(2);
      game.raf = requestAnimationFrame(frame);
    }
    tick();
    game.interval = setInterval(tick, 100);
    game.raf = requestAnimationFrame(frame);
    saveState();
  }

  function updateAnsweredCount() {
    if (!game) return;
    var el = $('qs-count'), n = String(Object.keys(game.answers).length);
    if (el.textContent !== n) {
      el.textContent = n;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
  }

  function handleAnswer(p, d) {
    if (game.phase !== 'question' || d.q !== game.qIndex) return;
    if (game.answers[p.pid]) { send(p, { t: 'locked', index: game.qIndex, total: total() }); return; }   // repeat = resend
    var q = curQ(), c = parseInt(d.c, 10);
    if (!(c >= 0 && c < q.answers.length)) return;
    var ms = Date.now() - game.qStart;
    if (ms > game.limit + 300) return;
    game.answers[p.pid] = { c: c, ms: Math.min(ms, game.limit) };
    send(p, { t: 'locked', index: game.qIndex, total: total() });
    updateAnsweredCount();
    S.locked();
    maybeAllAnswered();
  }

  function maybeAllAnswered() {
    if (!game || game.phase !== 'question') return;
    var online = values(game.players).filter(function (p) { return p.connected; });
    if (online.length && online.every(function (p) { return game.answers[p.pid]; })) {
      later(function () { if (game && game.phase === 'question') endQuestion(); }, 500);
    }
  }

  function endQuestion() {
    if (!game || game.phase !== 'question') return;
    clearTimers();
    S.stopMusic();
    S.gong();
    game.phase = 'reveal';
    var q = curQ(), i = game.qIndex, counts = q.answers.map(function () { return 0; });
    var players = values(game.players), res = {}, fastest = null, nCorrect = 0;
    players.forEach(function (p) {
      var a = game.answers[p.pid];
      var correct = !!a && q.correct.indexOf(a.c) >= 0;
      if (a) counts[a.c]++;
      if (correct) { nCorrect++; if (!fastest || a.ms < fastest.ms) fastest = { p: p, ms: a.ms }; }
      if (q.points !== 'none') p.streak = correct ? (p.streak || 0) + 1 : 0;
      var pts = TQ.calcPoints(correct, a ? a.ms : 0, game.limit, q.points, p.streak, game.settings.streak);
      p.prevScore = p.score;
      p.score += pts.total;
      if (correct) p.correctCount = (p.correctCount || 0) + 1;
      p.history[i] = { c: a ? a.c : null, ms: a ? a.ms : null, correct: correct, pts: pts.total };
      p.lastPts = pts.total;
      res[p.pid] = { a: a, correct: correct, pts: pts };
    });
    var r = ranked();
    players.forEach(function (p) {
      var x = res[p.pid], idx = r.indexOf(p), ahead = idx > 0 ? r[idx - 1] : null;
      p.lastResult = {
        t: 'result', index: i, total: total(), answered: !!x.a, correct: x.correct, points: x.pts.base, bonus: x.pts.bonus,
        score: p.score, prevScore: p.prevScore, streak: p.streak, rank: idx + 1, count: r.length,
        behind: ahead ? { name: ahead.name, gap: ahead.score - p.score } : null,
        correctIdx: q.correct, choice: x.a ? x.a.c : null, type: q.type, noPoints: q.points === 'none'
      };
      send(p, p.lastResult);
    });
    game.nextIndex = i + 1;

    $('rv-title').textContent = q.question;
    var max = Math.max.apply(null, counts.concat([1])), st = TQ.answerStyles(q.type);
    $('rv-chart').innerHTML = '<div class="chart">' + counts.map(function (n, j) {
      var ok = q.correct.indexOf(j) >= 0;
      return '<div class="cbar' + (ok ? '' : ' lose') + '"><div class="fill" data-h="' + Math.round(n / max * 100) + '" style="background:' + st[j].color +
        ';transition-delay:' + (j * 0.08) + 's"></div><div class="lab" style="background:' + st[j].color + '">' + TQ.shapeSVG(st[j].shape) + n + (ok ? ' ✔' : '') + '</div></div>';
    }).join('') + '</div>';
    var facts = '<span class="pill">✔ ' + nCorrect + ' of ' + players.length + ' got it right</span>';
    if (fastest) facts += '<span class="pill">⚡ Fastest: ' + TQ.avatarHTML(fastest.p.avatar, 'sm') + esc(fastest.p.name) + ' · ' + (fastest.ms / 1000).toFixed(1) + ' s</span>';
    $('rv-facts').innerHTML = facts;
    $('rv-tiles').innerHTML = tilesHTML(q, true);
    $('rv-next').textContent = game.nextIndex >= total() ? 'Show podium 🏆' : 'Next';
    show('reveal');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.querySelectorAll('#rv-chart .fill').forEach(function (f) { f.style.height = f.getAttribute('data-h') + '%'; });
      });
    });
    saveState();
  }

  function showScoreboard() {
    clearTimers();
    game.phase = 'scoreboard';
    var now = ranked();
    var before = values(game.players).sort(function (a, b) {
      return (b.prevScore || 0) - (a.prevScore || 0) || a.joinedAt - b.joinedAt;
    });
    var top = now.slice(0, 5), box = $('sb-list');
    box.style.height = (Math.max(1, top.length) * SB_ROW) + 'px';
    box.innerHTML = top.map(function (p) {
      var from = Math.min(before.indexOf(p), 5);
      return '<div class="sb-row" data-pid="' + esc(p.pid) + '" style="transform:translateY(' + (from * SB_ROW) + 'px);opacity:' + (from >= 5 ? 0 : 1) + '">' +
        '<span class="pos">' + (from + 1 > 5 ? '' : from + 1) + '</span>' + TQ.avatarHTML(p.avatar) +
        '<span class="nm">' + esc(p.name) + '</span>' + (p.streak >= 2 ? '<span class="streak">🔥' + p.streak + '</span>' : '') +
        (p.lastPts ? '<span class="delta">+' + TQ.fmt(p.lastPts) + '</span>' : '') +
        '<span class="sc">' + TQ.fmt(p.prevScore || 0) + '</span></div>';
    }).join('') || '<div class="waiting">No players</div>';
    var hot = now.filter(function (p) { return p.streak >= 3; }).sort(function (a, b) { return b.streak - a.streak; })[0];
    $('sb-note').textContent = hot ? '🔥 ' + hot.name + ' is on an answer streak of ' + hot.streak + '!' : '';
    show('scoreboard');
    box.querySelectorAll('.delta').forEach(function (d, k) { later(function () { d.classList.add('show'); }, 250 + k * 60); });
    later(function () {
      top.forEach(function (p, k) {
        var row = box.querySelector('[data-pid="' + CSS.escape(p.pid) + '"]');
        if (!row) return;
        row.style.transform = 'translateY(' + (k * SB_ROW) + 'px)';
        row.style.opacity = 1;
        row.querySelector('.pos').textContent = k + 1;
        row.classList.toggle('lead', k === 0);
        TQ.countUp(row.querySelector('.sc'), p.prevScore || 0, p.score, 1000);
      });
    }, 900);
    broadcast(standingMsg);
    saveState();
  }

  function showPodium() {
    clearTimers();
    S.stopMusic();
    game.phase = 'end';
    var r = ranked();
    $('podium').innerHTML = [1, 0, 2].map(function (ix) {
      var p = r[ix];
      if (!p) return '<div class="pod"></div>';
      return '<div class="pod p' + (ix + 1) + '" data-rank="' + (ix + 1) + '"><div class="who">' + (ix === 0 ? '<div class="crown">👑</div>' : '') +
        TQ.avatarHTML(p.avatar, ix === 0 ? 'huge' : 'big') +
        '<div class="nm">' + esc(p.name) + '</div><div class="pts">' + TQ.fmt(p.score) + ' pts · ' + (p.correctCount || 0) + '/' + total() + ' correct</div></div>' +
        '<div class="block">' + (ix + 1) + '</div></div>';
    }).join('');
    $('final-list').innerHTML = '';
    $('pd-actions').classList.remove('show');
    show('podium');
    var t = 700;
    if (r[2]) { later(function () { reveal(3); S.drum(); }, t); t += 1500; }
    if (r[1]) { later(function () { reveal(2); S.drum(); }, t); t += 1400; }
    for (var k = 0; k < 10; k++) later(S.drum, t + k * 110);
    t += 1250;
    later(function () { reveal(1); S.fanfare(); TQ.confetti(6000); }, t);
    later(function () {
      $('final-list').innerHTML = r.slice(3).map(function (p, k) {
        return '<div class="final-row" style="animation-delay:' + (k * 0.06) + 's"><b>' + (k + 4) + '</b>' + TQ.avatarHTML(p.avatar, 'sm') +
          '<span class="nm">' + esc(p.name) + '</span><span>' + TQ.fmt(p.score) + '</span></div>';
      }).join('');
      $('pd-actions').classList.add('show');
    }, t + 1600);
    function reveal(rank) {
      var el = document.querySelector('.pod[data-rank="' + rank + '"]');
      if (el) el.classList.add('show');
    }
    broadcast(endMsg);
    saveState();
  }

  function endHosting(silent) {
    if (!game) return;
    clearTimers();
    S.stopMusic();
    try { broadcast(function () { return { t: 'closed' }; }); } catch (e) { /* ignore */ }
    var p = peer;
    peer = null;
    setTimeout(function () { try { if (p) p.destroy(); } catch (e) { /* ignore */ } }, 600);
    game = null;
    try { localStorage.removeItem(ACTIVE_KEY); } catch (e) { /* ignore */ }
    if (!silent) renderLibrary();
  }

  $('pv-skip').onclick = function () { if (game && game.phase === 'preview') beginAnswering(); };
  $('qs-skip').onclick = function () { endQuestion(); };
  $('rv-next').onclick = function () {
    if (!game || game.phase !== 'reveal') return;
    if (game.nextIndex >= total()) showPodium(); else showScoreboard();
  };
  $('sb-next').onclick = function () { if (game && game.phase === 'scoreboard') nextQuestion(); };
  $('btn-end').onclick = function () {
    if (game && confirm('End the game now and show the podium?')) showPodium();
  };
  $('pd-home').onclick = function () { endHosting(); };
  $('pd-again').onclick = function () {
    if (!game) return;
    clearTimers();
    values(game.players).forEach(function (p) {
      p.score = 0; p.prevScore = 0; p.streak = 0; p.correctCount = 0; p.history = []; p.lastPts = 0; p.lastResult = null;
    });
    game.phase = 'lobby'; game.qIndex = -1; game.nextIndex = 0; game.started = false;
    $('players').innerHTML = '';
    setBackdrop(0);
    renderLobby();
    show('lobby');
    broadcast(function (p) { return { t: 'welcome', name: p.name, avatar: p.avatar, score: 0, title: game.quiz.title, bg: bgId(0) }; });
    broadcast(function () { return { t: 'lobby' }; });
    if (game.settings.music) S.music('lobby');
    saveState();
  };
  $('pd-csv').onclick = function () {
    if (!game) return;
    var qs = game.quiz.questions;
    var head = ['Rank', 'Name', 'Score', 'Correct'].concat(qs.map(function (q, i) { return 'Q' + (i + 1) + ' points'; }));
    var rows = ranked().map(function (p, k) {
      return [k + 1, p.name, p.score, p.correctCount || 0].concat(qs.map(function (q, i) {
        var h = p.history[i];
        return h ? h.pts : '';
      }));
    });
    var csv = [head].concat(rows).map(function (r) {
      return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\r\n');
    TQ.download(TQ.safeFileName(game.quiz.title) + '-results.csv', '\uFEFF' + csv, 'text/csv');
  };

  /* ---------- Save / resume ---------- */
  function saveState() {
    if (!game) return;
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({
        quizId: game.quiz.id, title: game.quiz.title, code: game.code, phase: game.phase, nextIndex: game.nextIndex,
        total: total(), banned: game.banned, savedAt: Date.now(),
        players: values(game.players).map(function (p) {
          return { pid: p.pid, name: p.name, avatar: p.avatar, score: p.score, streak: p.streak, correctCount: p.correctCount || 0,
            history: p.history || [], joinedAt: p.joinedAt };
        })
      }));
    } catch (e) { /* ignore */ }
  }
  function readSaved() {
    try {
      var s = JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null');
      if (!s || s.phase === 'end' || Date.now() - s.savedAt > 6 * 3600 * 1000) return null;
      return s;
    } catch (e) { return null; }
  }
  function renderResumeBanner() {
    var s = readSaved(), b = $('resume-banner');
    if (!s || game) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = '<span>⚠ A game was interrupted: <b>' + esc(s.title) + '</b>, PIN ' + esc(s.code) + ', ' + s.players.length +
      ' players, ' + (s.nextIndex > 0 ? 'next is question ' + (s.nextIndex + 1) + ' of ' + s.total : 'still in the lobby') + '.</span>' +
      '<span class="spacer"></span><button class="go small" id="rs-go">Resume</button><button class="small" id="rs-drop">Discard</button>';
    $('rs-go').onclick = function () {
      TQ.Store.get(s.quizId).then(function (quiz) {
        if (!quiz) { alert('That quiz no longer exists.'); return; }
        startHosting(quiz, s);
      });
    };
    $('rs-drop').onclick = function () {
      try { localStorage.removeItem(ACTIVE_KEY); } catch (e) { /* ignore */ }
      b.hidden = true;
    };
  }

  /* ---------- Top bar & keys ---------- */
  function muteIcon() { $('btn-mute').textContent = S.isMuted() ? '🔇' : '🔊'; }
  $('btn-mute').onclick = function () {
    S.unlock();
    S.setMuted(!S.isMuted());
    muteIcon();
  };
  $('btn-full').onclick = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  };
  document.addEventListener('keydown', function (e) {
    if (!game || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'ArrowRight') return;
    var screen = document.body.getAttribute('data-screen');
    var btn = { reveal: 'rv-next', scoreboard: 'sb-next', preview: 'pv-skip' }[screen];
    if (btn) { e.preventDefault(); $(btn).click(); }
  });
  window.addEventListener('beforeunload', function (e) {
    if (game && game.started && game.phase !== 'end') { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('pointerdown', function () { S.unlock(); }, { once: true });

  muteIcon();
  renderLibrary();

  // Hook for automated tests only.
  window.__tqHost = { get game() { return game; } };
})();
