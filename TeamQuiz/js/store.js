/* Quiz storage (IndexedDB on the host's laptop), import/export and validation. */
(function () {
  'use strict';
  var TQ = window.TQ = window.TQ || {};

  TQ.TIMES = [5, 10, 20, 30, 45, 60, 90, 120];
  var LETTERS = ['A', 'B', 'C', 'D'];

  /* ---------------- IndexedDB ---------------- */
  var dbPromise = null, memory = {};
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve) {
        if (!window.indexedDB) { resolve(null); return; }
        var req;
        try { req = indexedDB.open('teamquiz', 1); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = function () { req.result.createObjectStore('quizzes', { keyPath: 'id' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      });
    }
    return dbPromise;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      if (!d) return fn(null);
      return new Promise(function (resolve, reject) {
        var t = d.transaction('quizzes', mode), st = t.objectStore('quizzes'), out;
        var r = fn(st);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Storage full or blocked')); };
      });
    });
  }
  TQ.Store = {
    persistent: function () { return db().then(function (d) { return !!d; }); },
    all: function () {
      return tx('readonly', function (st) { return st ? st.getAll() : null; }).then(function (r) {
        var list = r || Object.keys(memory).map(function (k) { return memory[k]; });
        return list.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      });
    },
    get: function (id) {
      return tx('readonly', function (st) { return st ? st.get(id) : null; }).then(function (r) {
        return r || memory[id] || null;
      });
    },
    put: function (quiz) {
      quiz.updated = Date.now();
      return tx('readwrite', function (st) {
        if (!st) { memory[quiz.id] = quiz; return null; }
        return st.put(quiz);
      }).then(function () { return quiz; });
    },
    del: function (id) {
      delete memory[id];
      return tx('readwrite', function (st) { return st ? st.delete(id) : null; });
    }
  };

  /* ---------------- Validation / normalisation ---------------- */
  function normTime(t) {
    var n = parseInt(t, 10);
    if (!n || n < 5) return 20;
    return Math.min(n, 240);
  }
  function normPoints(p) {
    var s = String(p == null ? '' : p).toLowerCase().trim();
    if (s === 'double' || s === '2000' || s === '2' || s === 'x2') return 'double';
    if (s === 'none' || s === '0' || s === 'no' || s === 'nopoints') return 'none';
    return 'standard';
  }
  function answerText(a) {
    if (a && typeof a === 'object') return String(a.text || a.answer || a.option || '').trim();
    return String(a == null ? '' : a).trim();
  }

  function resolveCorrect(corr, answers) {
    var list = Array.isArray(corr) ? corr : [corr];
    var out = [];
    list.forEach(function (c) {
      var ix = -1;
      if (typeof c === 'number') ix = Math.floor(c);
      else if (c != null) {
        var s = String(c).trim();
        if (/^[A-Da-d]$/.test(s)) ix = LETTERS.indexOf(s.toUpperCase());
        else if (/^\d+$/.test(s)) ix = parseInt(s, 10);
        else {
          var low = s.toLowerCase().replace(/^[a-d][\).:]\s*/, '');
          answers.forEach(function (a, i) { if (a.toLowerCase() === low || a.toLowerCase() === s.toLowerCase()) ix = i; });
        }
      }
      if (ix >= 0 && ix < answers.length && out.indexOf(ix) < 0) out.push(ix);
    });
    return out.sort();
  }

  function normalizeQuestion(q) {
    if (!q || typeof q !== 'object') throw new Error('not a question');
    var text = String(q.question || q.text || q.q || q.title || '').trim();
    if (!text) throw new Error('missing question text');
    var type = String(q.type || '').toLowerCase().replace(/[^a-z]/g, '');
    var answers = q.answers || q.options || q.choices;
    var corr = q.correct;
    if (corr === undefined) corr = q.answer;
    if (corr === undefined) corr = q.correctAnswer;
    if (corr === undefined) corr = q.correct_answer;

    var isTF = type === 'truefalse' || type === 'tf' || type === 'boolean' ||
      (!answers && (typeof corr === 'boolean' || /^(true|false)$/i.test(String(corr))));
    if (!isTF && Array.isArray(answers) && answers.length === 2 &&
      /^true$/i.test(answerText(answers[0])) && /^false$/i.test(answerText(answers[1]))) isTF = true;

    var res = {
      type: isTF ? 'truefalse' : 'quiz',
      question: text.slice(0, 300),
      time: normTime(q.time || q.seconds || q.timeLimit || q.time_limit),
      points: normPoints(q.points),
      image: q.image ? String(q.image) : ''
    };

    if (isTF) {
      res.answers = ['True', 'False'];
      var v = Array.isArray(corr) ? corr[0] : corr;
      var s = String(v).trim().toLowerCase();
      if (v === true || s === 'true' || s === 't' || s === 'yes' || s === 'a') res.correct = [0];
      else if (v === false || s === 'false' || s === 'f' || s === 'no' || s === 'b') res.correct = [1];
      else throw new Error('true/false question needs "correct": true or false');
      return res;
    }

    if (!Array.isArray(answers)) throw new Error('missing answers');
    var flagged = [];
    answers.forEach(function (a, i) { if (a && typeof a === 'object' && (a.correct === true || a.isCorrect === true)) flagged.push(i); });
    var texts = answers.map(answerText);
    var keep = [];
    texts.forEach(function (t, i) { if (t) keep.push(i); });
    if (keep.length < 2) throw new Error('needs at least 2 answers');
    if (keep.length > 4) throw new Error('has ' + keep.length + ' answers, the maximum is 4');
    res.answers = keep.map(function (i) { return texts[i].slice(0, 120); });
    var idx = flagged.length ? flagged.map(function (i) { return keep.indexOf(i); }).filter(function (i) { return i >= 0; })
      : resolveCorrect(corr, res.answers);
    if (!idx.length) throw new Error('no valid correct answer (use "correct": "A", "B", "C" or "D")');
    res.correct = idx;
    return res;
  }
  TQ.normalizeQuestion = normalizeQuestion;

  TQ.extractJSON = function (text) {
    text = String(text || '').replace(/```(?:json)?/gi, '');
    var a = text.indexOf('{'), b = text.indexOf('[');
    var start = (a < 0) ? b : (b < 0 ? a : Math.min(a, b));
    if (start < 0) throw new Error('No quiz data found in the pasted text.');
    var close = text[start] === '{' ? '}' : ']';
    var end = text.lastIndexOf(close);
    if (end <= start) throw new Error('The quiz data looks cut off. Copy the whole reply from Claude.');
    return text.slice(start, end + 1);
  };

  TQ.normalizeQuiz = function (raw, fallbackTitle) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(TQ.extractJSON(raw)); }
      catch (e) { throw new Error(e instanceof SyntaxError ? 'The quiz text is not valid JSON (' + e.message + ').' : e.message); }
    }
    if (Array.isArray(raw)) raw = { questions: raw };
    if (!raw || typeof raw !== 'object') throw new Error('That does not look like a quiz.');
    var qs = raw.questions || raw.quiz || raw.items;
    if (!Array.isArray(qs) || !qs.length) throw new Error('No questions found. The quiz needs a "questions" list.');
    var warnings = [], out = [];
    qs.forEach(function (q, i) {
      try { out.push(normalizeQuestion(q)); }
      catch (e) { warnings.push('Question ' + (i + 1) + ' skipped: ' + e.message); }
    });
    if (!out.length) throw new Error('None of the questions could be read.\n' + warnings.join('\n'));
    var theme = String(raw.theme || '').toLowerCase();
    var themeImage = typeof raw.themeImage === 'string' && /^(data:image\/|https?:)/.test(raw.themeImage) ? raw.themeImage : '';
    if (theme === 'custom' && !themeImage) theme = '';
    if (theme !== 'rotate' && theme !== 'custom' && !TQ.isTheme(theme)) theme = TQ.DEFAULT_THEME;
    return {
      quiz: { id: TQ.newId(), title: String(raw.title || raw.name || fallbackTitle || 'Untitled quiz').trim().slice(0, 120),
        theme: theme, themeImage: theme === 'custom' ? themeImage : '', questions: out, updated: Date.now() },
      warnings: warnings
    };
  };

  /* ---------------- CSV ---------------- */
  function parseCSVRows(text) {
    var rows = [], row = [], cell = '', q = false, i, ch;
    text = String(text).replace(/^\uFEFF/, '');
    var delim = ',';
    var firstLine = text.split(/\r?\n/)[0];
    if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delim = ';';
    if ((firstLine.match(/\t/g) || []).length > (firstLine.match(new RegExp(delim, 'g')) || []).length) delim = '\t';
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
  }

  TQ.parseCSV = function (text, title) {
    var rows = parseCSVRows(text);
    if (rows.length < 2) throw new Error('The CSV needs a header row and at least one question row.');
    var head = rows[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); });
    function col(names) {
      for (var i = 0; i < head.length; i++) if (names.indexOf(head[i]) >= 0) return i;
      return -1;
    }
    var cQ = col(['question', 'text', 'q']);
    var cAns = [col(['a', 'answer1', 'option1', 'answera', 'optiona']), col(['b', 'answer2', 'option2', 'answerb', 'optionb']),
      col(['c', 'answer3', 'option3', 'answerc', 'optionc']), col(['d', 'answer4', 'option4', 'answerd', 'optiond'])];
    var cCor = col(['correct', 'correctanswer', 'answer', 'right']);
    var cTime = col(['time', 'seconds', 'timelimit']);
    var cPts = col(['points', 'score']);
    var cType = col(['type']);
    var cImg = col(['image', 'imageurl', 'picture']);
    if (cQ < 0 || cCor < 0) throw new Error('The CSV needs at least "question" and "correct" columns.');
    var list = rows.slice(1).map(function (r) {
      function v(c) { return c >= 0 ? String(r[c] == null ? '' : r[c]).trim() : ''; }
      var answers = cAns.map(v).filter(Boolean);
      return { question: v(cQ), answers: answers.length ? answers : undefined, correct: v(cCor),
        time: v(cTime), points: v(cPts), type: v(cType), image: v(cImg) };
    });
    return TQ.normalizeQuiz({ title: title, questions: list }, title);
  };

  TQ.importText = function (text, fileName) {
    var title = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    var trimmed = String(text).trim();
    if (/\.csv$/i.test(fileName || '') || (!/^[\[{`]/.test(trimmed) && /^[^\n]*question/i.test(trimmed) && trimmed.indexOf('{') < 0)) {
      return TQ.parseCSV(text, title || 'Imported quiz');
    }
    return TQ.normalizeQuiz(text, title);
  };

  TQ.exportQuiz = function (quiz) {
    var out = { title: quiz.title, theme: quiz.theme || TQ.DEFAULT_THEME };
    if (quiz.theme === 'custom' && quiz.themeImage) out.themeImage = quiz.themeImage;
    out.questions = quiz.questions.map(function (q) {
      var o = { type: q.type, question: q.question };
      if (q.type === 'truefalse') o.correct = q.correct[0] === 0;
      else {
        o.answers = q.answers.slice();
        o.correct = q.correct.length === 1 ? LETTERS[q.correct[0]] : q.correct.map(function (i) { return LETTERS[i]; });
      }
      o.time = q.time;
      if (q.points !== 'standard') o.points = q.points;
      if (q.image) o.image = q.image;
      return o;
    });
    return out;
  };
  TQ.download = function (name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  TQ.safeFileName = function (s) {
    return (String(s || 'quiz').replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '-') || 'quiz').slice(0, 60);
  };

  /* Shrink an image to at most maxDim px so quizzes stay small and load fast. */
  TQ.imageToDataURL = function (file, maxDim, quality) {
    maxDim = maxDim || 1280;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('That file is not an image.')); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read that image.')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Could not read that image.')); };
        img.onload = function () {
          var s = Math.min(1, maxDim / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s));
          c.height = Math.max(1, Math.round(img.height * s));
          var g = c.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality || 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  };

  /* Text Vinny pastes into Claude so it returns a quiz this app can load directly. */
  TQ.CLAUDE_PROMPT = [
    'Create a fun team quiz about: [TOPIC]. Make [NUMBER] questions.',
    '',
    'Reply with ONLY a JSON code block in exactly this format, nothing else:',
    '',
    '{',
    '  "title": "Quiz title",',
    '  "questions": [',
    '    { "type": "quiz", "question": "Which planet is known as the Red Planet?",',
    '      "answers": ["Venus", "Mars", "Jupiter", "Saturn"], "correct": "B", "time": 20 },',
    '    { "type": "truefalse", "question": "Octopuses have three hearts.", "correct": true, "time": 10 }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- "type" is "quiz" (2 to 4 answers) or "truefalse".',
    '- For "quiz", "correct" is the letter of the right answer: "A", "B", "C" or "D" (first answer is A). Use a list like ["A","C"] only if more than one answer is right.',
    '- For "truefalse", "correct" is true or false, and there is no "answers" list.',
    '- Keep questions under 120 characters and answers under 60 characters.',
    '- "time" is seconds to answer: 10 for easy, 20 for normal, 30 for harder questions.',
    '- Optional: add "points": "double" to one or two of the hardest questions.',
    '- Add a top-level "theme" that suits the topic, one of: galaxy, night-sky, summit, beach, highlands, lake, mountain-lake, city, party, arcade, rotate.',
    '- Mix the position of the correct answer and keep it suitable for work.'
  ].join('\n');
})();
