/* Shared helpers for host and player pages: avatars, answer shapes, scoring, sounds, confetti. */
(function () {
  'use strict';
  var TQ = window.TQ = window.TQ || {};

  /* ---------------- Avatars (image files listed in js/avatars.js) ---------------- */
  TQ.AVATAR_GROUPS = window.TQ_AVATAR_GROUPS || [];
  TQ.AVATARS = [];
  TQ.AVATAR_SRC = {};
  TQ.AVATAR_GROUPS.forEach(function (g) {
    g.items.forEach(function (it) { TQ.AVATARS.push(it.id); TQ.AVATAR_SRC[it.id] = it.src; });
  });
  TQ.COLORS = ['#7b3fe4', '#1368ce', '#0aa3a3', '#26890c', '#d89e00', '#e05a00',
    '#e21b3c', '#d63384', '#ff8fb1', '#8fd3ff', '#455a64', '#2b2440'];

  TQ.cleanAvatar = function (a) {
    a = a || {};
    var id = TQ.AVATAR_SRC[a.id] ? a.id : (TQ.AVATARS[0] || '');
    var c = TQ.COLORS.indexOf(a.c) >= 0 ? a.c : TQ.COLORS[0];
    return { id: id, c: c };
  };

  TQ.avatarHTML = function (a, cls) {
    a = TQ.cleanAvatar(a);
    var src = TQ.AVATAR_SRC[a.id] || '';
    return '<span class="avatar ' + (cls || '') + '" style="--av:' + a.c + '">' +
      (src ? '<img alt="" draggable="false" src="' + TQ.esc(src) + '">' : '') + '</span>';
  };

  /* ---------------- Background themes (photos in assets/bg, Unsplash licence) ---------------- */
  TQ.THEMES = [
    { id: 'galaxy', name: 'Galaxy' }, { id: 'night-sky', name: 'Night sky' }, { id: 'summit', name: 'Summit' },
    { id: 'beach', name: 'Beach' }, { id: 'highlands', name: 'Highlands' }, { id: 'lake', name: 'Lake' },
    { id: 'mountain-lake', name: 'Mountain lake' }, { id: 'city', name: 'City' }, { id: 'party', name: 'Party' },
    { id: 'arcade', name: 'Arcade' }
  ];
  TQ.DEFAULT_THEME = 'galaxy';
  TQ.isTheme = function (id) { return TQ.THEMES.some(function (t) { return t.id === id; }); };
  TQ.themeURL = function (id) { return 'assets/bg/' + (TQ.isTheme(id) ? id : TQ.DEFAULT_THEME) + '.jpg'; };
  TQ.themeThumb = function (id) { return 'assets/bg/thumb/' + (TQ.isTheme(id) ? id : TQ.DEFAULT_THEME) + '.jpg'; };
  /* Which built-in theme id a quiz uses for question i ('' when it uses its own uploaded picture). */
  TQ.themeIdFor = function (quiz, i) {
    var t = quiz && quiz.theme;
    if (t === 'custom' && quiz.themeImage) return '';
    if (t === 'rotate') return TQ.THEMES[Math.max(0, i || 0) % TQ.THEMES.length].id;
    return TQ.isTheme(t) ? t : TQ.DEFAULT_THEME;
  };
  TQ.themeImageFor = function (quiz, i) {
    var id = TQ.themeIdFor(quiz, i);
    return id ? TQ.themeURL(id) : quiz.themeImage;
  };

  /* Full-screen photo backdrop with a cross-fade and a slow zoom. */
  TQ.Backdrop = (function () {
    var root = null, layers = null, cur = 0, want = '';
    function init() {
      root = document.getElementById('backdrop');
      if (!root) {
        root = document.createElement('div');
        root.id = 'backdrop';
        document.body.insertBefore(root, document.body.firstChild);
      }
      root.innerHTML = '<div class="bd-img"></div><div class="bd-img"></div><div class="bd-shade"></div><div class="bd-glow"></div>';
      layers = root.querySelectorAll('.bd-img');
    }
    return {
      set: function (url) {
        if (!layers) init();
        if (!url || url === want) return;
        want = url;
        var img = new Image();
        img.onload = function () {
          if (want !== url) return;
          var next = layers[1 - cur];
          next.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
          next.classList.remove('kb');
          void next.offsetWidth;
          next.classList.add('on', 'kb');
          layers[cur].classList.remove('on');
          cur = 1 - cur;
        };
        img.src = url;
      },
      calm: function (on) { document.body.classList.toggle('calm', !!on); }
    };
  })();

  /* Animate a number in an element from one value to another. */
  TQ.countUp = function (el, from, to, ms) {
    if (!el) return;
    var t0 = performance.now();
    ms = ms || 900;
    (function step(now) {
      var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = TQ.fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  };

  // Kahoot answer colours and shapes. True/False uses blue + red.
  TQ.ANSWER_STYLES = [
    { shape: 'triangle', color: '#e21b3c' },
    { shape: 'diamond', color: '#1368ce' },
    { shape: 'circle', color: '#d89e00' },
    { shape: 'square', color: '#26890c' }
  ];
  TQ.TF_STYLES = [
    { shape: 'diamond', color: '#1368ce' },
    { shape: 'triangle', color: '#e21b3c' }
  ];
  TQ.answerStyles = function (type) {
    return type === 'truefalse' ? TQ.TF_STYLES : TQ.ANSWER_STYLES;
  };
  TQ.shapeSVG = function (shape) {
    var p = {
      triangle: '<polygon points="16,3 30,28 2,28"/>',
      diamond: '<polygon points="16,1 31,16 16,31 1,16"/>',
      circle: '<circle cx="16" cy="16" r="14"/>',
      square: '<rect x="3" y="3" width="26" height="26"/>'
    }[shape] || '';
    return '<svg class="shape" viewBox="0 0 32 32" aria-hidden="true"><g fill="#fff">' + p + '</g></svg>';
  };

  /*
   * Kahoot scoring (support.kahoot.com "How points work"):
   *   points = 1000 * (1 - (responseTime / timer) / 2), rounded down
   *   answers inside 0.5 s get the full 1000; double points = x2; wrong = 0.
   * Optional streak bonus (Kahoot's old Answer Streak Bonus): +100 per correct answer in a
   * row after the first, capped at +500. It is never doubled.
   */
  TQ.calcPoints = function (correct, ms, limitMs, mode, newStreak, streakBonusOn) {
    if (!correct || mode === 'none') return { base: 0, bonus: 0, total: 0 };
    var frac = Math.min(Math.max(ms / limitMs, 0), 1);
    var base = ms <= 500 ? 1000 : Math.floor(1000 * (1 - frac / 2));
    if (mode === 'double') base *= 2;
    var bonus = 0;
    if (streakBonusOn && newStreak >= 2) bonus = Math.min((newStreak - 1) * 100, 500);
    return { base: base, bonus: bonus, total: base + bonus };
  };

  TQ.ordinal = function (n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  TQ.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  TQ.fmt = function (n) { return Number(n || 0).toLocaleString('en-GB'); };

  TQ.newId = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  };

  /* ---------------- Sound: everything synthesised with Web Audio, no files ---------------- */
  TQ.Sound = (function () {
    var ctx = null, master = null, muted = false, musicTimer = null, musicName = '';
    try { muted = localStorage.getItem('tq_muted') === '1'; } catch (e) { /* ignore */ }

    function ac() {
      if (!ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function tone(midi, start, dur, type, vol) {
      var c = ac();
      if (!c || muted) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq(midi);
      var t = c.currentTime + (start || 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }

    var SONGS = {
      lobby: (function () {
        var chords = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]];
        var pat = [0, 1, 2, 3, 2, 1, 2, 3], steps = [];
        chords.forEach(function (ch) {
          pat.forEach(function (ix, k) {
            steps.push({ n: [ch[ix] + 12], b: (k % 4 === 0) ? ch[0] - 12 : 0 });
          });
        });
        return { bpm: 230, steps: steps, wave: 'triangle', vol: 0.07 };
      })(),
      question: (function () {
        var mel = [69, 0, 76, 0, 69, 0, 77, 0, 69, 0, 76, 0, 69, 74, 76, 77,
          69, 0, 76, 0, 69, 0, 79, 0, 77, 0, 76, 0, 74, 72, 71, 72];
        var steps = mel.map(function (m, k) {
          return { n: m ? [m] : [], b: (k % 2 === 0) ? 45 : 0 };
        });
        return { bpm: 300, steps: steps, wave: 'square', vol: 0.035 };
      })()
    };

    return {
      isMuted: function () { return muted; },
      setMuted: function (m) {
        muted = !!m;
        try { localStorage.setItem('tq_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
        if (muted) { this.stopMusic(true); }
        else if (musicName) { var n = musicName; musicName = ''; this.music(n); }
      },
      unlock: function () { ac(); },
      music: function (name) {
        if (musicName === name && musicTimer) return;
        this.stopMusic();
        musicName = name;
        var song = SONGS[name];
        if (!song || muted) return;
        var i = 0, stepS = 60 / song.bpm;
        musicTimer = setInterval(function () {
          var s = song.steps[i % song.steps.length];
          s.n.forEach(function (m) { tone(m, 0, stepS * 1.6, song.wave, song.vol); });
          if (s.b) tone(s.b, 0, stepS * 1.8, 'sine', song.vol * 2.2);
          i++;
        }, stepS * 1000);
      },
      stopMusic: function (keepName) {
        if (musicTimer) clearInterval(musicTimer);
        musicTimer = null;
        if (!keepName) musicName = '';
      },
      pop: function () { tone(76, 0, 0.12, 'sine', 0.25); tone(83, 0.07, 0.15, 'sine', 0.2); },
      tick: function () { tone(93, 0, 0.06, 'square', 0.08); },
      gong: function () {
        tone(45, 0, 1.6, 'sawtooth', 0.12); tone(57, 0, 1.4, 'triangle', 0.2); tone(64, 0.02, 1.2, 'sine', 0.12);
      },
      correct: function () { [72, 76, 79, 84].forEach(function (m, i) { tone(m, i * 0.08, 0.3, 'triangle', 0.22); }); },
      wrong: function () { tone(55, 0, 0.25, 'sawtooth', 0.12); tone(50, 0.22, 0.45, 'sawtooth', 0.12); },
      locked: function () { tone(79, 0, 0.1, 'sine', 0.18); },
      drum: function () { tone(40, 0, 0.18, 'sine', 0.35); },
      fanfare: function () {
        [[60, 0], [64, 0.15], [67, 0.3], [72, 0.45]].forEach(function (x) { tone(x[0], x[1], 0.3, 'triangle', 0.22); });
        [72, 76, 79].forEach(function (m) { tone(m, 0.65, 1.4, 'triangle', 0.16); });
      }
    };
  })();

  /* ---------------- Confetti ---------------- */
  TQ.confetti = function (durationMs) {
    var cv = document.createElement('canvas');
    cv.className = 'confetti';
    document.body.appendChild(cv);
    var g = cv.getContext('2d'), W, H, parts = [], end = Date.now() + (durationMs || 4000);
    function size() { W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; }
    size();
    window.addEventListener('resize', size);
    var cols = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#ffffff', '#ff7ac6', '#7af7ff'];
    function add(n) {
      for (var i = 0; i < n; i++) {
        parts.push({ x: Math.random() * W, y: -20, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4,
          r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
          c: cols[(Math.random() * cols.length) | 0] });
      }
    }
    (function frame() {
      if (Date.now() < end) add(6);
      g.clearRect(0, 0, W, H);
      parts = parts.filter(function (p) { return p.y < H + 30; });
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      });
      if (parts.length || Date.now() < end) requestAnimationFrame(frame);
      else { window.removeEventListener('resize', size); cv.remove(); }
    })();
  };

  TQ.toast = function (msg, ms) {
    document.querySelectorAll('.toast').forEach(function (old) { old.remove(); });
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 400); }, ms || 3500);
  };
})();
