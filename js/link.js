/*
 * Game connections over the PeerJS server's secure WebSocket (port 443) instead of direct WebRTC.
 *
 * Why: company networks and VPNs often block direct peer-to-peer WebRTC links ("Connection to the
 * host failed"), but players can always reach the PeerJS server, because that is how they find the game.
 * So every game message is relayed through that server, the same way Kahoot talks through its servers.
 * The PeerJS server stamps the sender's id on each message, so a player cannot pretend to be someone else.
 *
 * The objects returned here behave like PeerJS DataConnections: .open, .peer, .send(obj), .close(),
 * and the events 'open', 'data', 'close', 'error'.
 */
(function () {
  'use strict';
  var TQ = window.TQ = window.TQ || {};
  var PING_MS = 4000;      // keep-alive in both directions
  var DEAD_MS = 20000;     // nothing heard for this long = connection lost (generous: background tabs run timers slowly)
  var HELLO_MS = 1500;     // a dialling player repeats "hi" until the host answers

  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; };
  Emitter.prototype.emit = function (ev, arg) {
    (this._h[ev] || []).slice().forEach(function (fn) {
      try { fn(arg); } catch (e) { console.error('[link]', e); }
    });
  };

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  /* The server only forwards known signalling types, so game messages ride inside CANDIDATE
     messages. They carry no connectionId, so PeerJS itself ignores them. */
  function raw(peer, dst, msg) {
    try {
      if (!peer.destroyed && peer.socket) peer.socket.send({ type: 'CANDIDATE', dst: dst, payload: { tq: 1, m: msg } });
    } catch (e) { /* socket closed: keep-alives will notice */ }
  }

  function Conn(peer, remote, id) {
    Emitter.call(this);
    this._p = peer;
    this.peer = remote;
    this.id = id;
    this.open = false;
    this.seen = Date.now();
    this._lastPing = 0;
    this._done = false;
    this._hello = null;
  }
  Conn.prototype = Object.create(Emitter.prototype);
  Conn.prototype.send = function (data) {
    if (!this.open) throw new Error('Connection is not open');
    raw(this._p, this.peer, { k: 'd', id: this.id, d: data });
  };
  Conn.prototype.close = function () {
    if (this._done) return;
    raw(this._p, this.peer, { k: 'bye', id: this.id });
    this._end();
  };
  Conn.prototype._end = function () {
    if (this._done) return;
    this._done = true;
    this.open = false;
    clearInterval(this._hello);
    var st = this._p.__tq;
    if (st && st.conns[this.peer] === this) delete st.conns[this.peer];
    this.emit('close');
  };

  function state(peer) {
    if (peer.__tq) return peer.__tq;
    var st = peer.__tq = { conns: {}, onConn: null, timer: null };
    peer.socket.on('message', function (m) {
      if (!m || !m.src) return;
      // The server answers EXPIRE when the other side is gone (closed tab, reloaded page).
      if (m.type === 'EXPIRE' || m.type === 'LEAVE') { if (st.conns[m.src] && st.conns[m.src].open) st.conns[m.src]._end(); return; }
      if (!m.payload || m.payload.tq !== 1) return;
      handle(peer, st, m.src, m.payload.m || {});
    });
    st.timer = setInterval(function () { tick(peer, st); }, 1000);
    return st;
  }

  function handle(peer, st, src, m) {
    var c = st.conns[src];
    if (m.k === 'hi') {
      if (!st.onConn || !m.id) return;                       // only the host accepts players
      if (c && c.open && c.id === m.id) { c.seen = Date.now(); raw(peer, src, { k: 'ok', id: m.id }); return; }
      if (c) c._end();                                        // same player dialled again
      c = new Conn(peer, src, String(m.id).slice(0, 40));
      c.open = true;
      st.conns[src] = c;
      st.onConn(c);
      raw(peer, src, { k: 'ok', id: c.id });
      return;
    }
    if (!c || c.id !== m.id) {
      // Message for a connection we don't know (e.g. the host page was reloaded): tell the
      // sender so it reconnects straight away instead of waiting for the keep-alive timeout.
      if (m.k !== 'bye' && m.id) raw(peer, src, { k: 'bye', id: m.id });
      return;
    }
    c.seen = Date.now();
    if (m.k === 'ok') {
      if (!c.open) { c.open = true; clearInterval(c._hello); c.emit('open'); }
    } else if (m.k === 'd') {
      if (c.open) c.emit('data', m.d);
    } else if (m.k === 'bye') {
      c._end();
    }
  }

  function tick(peer, st) {
    var keys = Object.keys(st.conns);
    if (peer.destroyed) {
      clearInterval(st.timer);
      keys.forEach(function (k) { st.conns[k]._end(); });
      return;
    }
    var now = Date.now();
    keys.forEach(function (k) {
      var c = st.conns[k];
      if (!c || !c.open) return;
      if (now - c.seen > DEAD_MS) { c._end(); return; }
      if (now - c._lastPing >= PING_MS) { c._lastPing = now; raw(peer, c.peer, { k: 'ping', id: c.id }); }
    });
  }

  TQ.Link = {
    /* Host: call once after creating the Peer. onConn(conn) runs for every player that dials in. */
    listen: function (peer, onConn) { state(peer).onConn = onConn; },
    /* Player: dial the host. Returns a connection that fires 'open' once the host answers. */
    dial: function (peer, hostId) {
      var st = state(peer);
      if (st.conns[hostId]) st.conns[hostId]._end();
      var c = new Conn(peer, hostId, newId());
      st.conns[hostId] = c;
      function hello() { if (!c._done && !c.open) raw(peer, hostId, { k: 'hi', id: c.id }); }
      hello();
      c._hello = setInterval(hello, HELLO_MS);
      return c;
    }
  };
})();
