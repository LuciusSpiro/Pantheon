// Netzwerk-Schicht (CONTRACT.md §3, §5). Globales `Net`.
// WebSocket zu ws(s)://<host>/ws, hello mit clientId aus localStorage, automatischer Reconnect,
// Ping/Pong, Lag-Simulator (?lag=150&loss=2). Mit ?mock=1 läuft der Transport über DevMock.
// Außerdem: zentrale Fehlerzählung (window.__game.errors) für alle Client-Module.
(function () {
  'use strict';

  const P = window.Shared_Protocol || { WS_PATH: '/ws', C: {}, S: {} };
  const params = new URLSearchParams(location.search);

  // window.__game ist laut Vertrag immer vorhanden; client.js füllt den Rest.
  const G = window.__game = window.__game || {};
  G.state = G.state || null;
  G.pid = G.pid || null;
  G.errors = G.errors || 0;
  G.fps = G.fps || 0;
  G.ping = G.ping || 0;
  G.send = G.send || function (msg) { Net.send(msg); };

  // ---- Fehlerzählung (gedrosselt geloggt, nie still geschluckt) ----
  const warnState = {};
  function reportError(label, err) {
    G.errors++;
    const now = Date.now();
    const w = warnState[label] || (warnState[label] = { t: 0, n: 0 });
    w.n++;
    if (now - w.t > 3000) {
      w.t = now;
      console.warn('[Pantheon] Fehler in ' + label + ' (bisher ' + w.n + '×):', err);
    }
  }
  function guard(label, fn, fallback) {
    try { return fn(); } catch (e) { reportError(label, e); return fallback; }
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function loadClientId() {
    const key = 'sternenschicht.clientId';
    let id = null;
    try { id = localStorage.getItem(key); } catch (e) { /* privat-Modus */ }
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(key, id); } catch (e) { /* egal */ }
    }
    return id;
  }

  // M0: Raumcode aus ?code= (hat Vorrang) oder localStorage; wird mit hello geschickt.
  const CODE_KEY = 'sternenschicht.roomCode';
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); }
  function loadRoomCode() {
    const fromUrl = normCode(params.get('code'));
    if (fromUrl) { try { localStorage.setItem(CODE_KEY, fromUrl); } catch (e) { /* egal */ } return fromUrl; }
    try { return normCode(localStorage.getItem(CODE_KEY)); } catch (e) { return ''; }
  }

  const lagMs = clamp(+params.get('lag') || 0, 0, 5000);
  const lossPct = clamp(+params.get('loss') || 0, 0, 90);

  const Net = {
    params,
    clientId: loadClientId(),
    roomCode: loadRoomCode(),   // eigener Code (Eingabe/URL/Speicher)
    serverRoomCode: null,       // vom Server im welcome bestätigt (null = Server ohne Code)
    badCode: false,             // letzter hello wurde mit badcode abgelehnt
    badCodeText: '',
    normCode,
    status: 'idle',        // idle | connecting | open | lost | full | nofile
    everConnected: false,
    attempts: 0,
    ping: 0,
    fullText: '',
    lag: lagMs, loss: lossPct,
    stats: { sent: 0, recv: 0, bytesIn: 0, lastSnapBytes: 0, dropped: 0 },
    onMessage: null,       // function(msg)
    onStatus: null,        // function(status)
    getHello: null,        // function() -> { name, color }
    reportError, guard,
    sock: null,
    _timer: null, _pingTimer: null, _stop: false,

    url() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + location.host + (P.WS_PATH || '/ws');
    },

    setStatus(s) {
      if (this.status === s) return;
      this.status = s;
      if (this.onStatus) guard('Net.onStatus', () => this.onStatus(s));
    },

    connect() {
      if (this._stop) return;
      clearTimeout(this._timer);
      const useMock = window.DevMock && DevMock.active;
      if (!useMock && location.protocol === 'file:') { this.setStatus('nofile'); return; }
      this.setStatus(this.everConnected ? 'lost' : 'connecting');
      this.attempts++;
      let sock;
      try {
        sock = useMock ? DevMock.createSocket() : new WebSocket(this.url());
      } catch (e) {
        reportError('Net.connect', e);
        this.scheduleReconnect();
        return;
      }
      this.sock = sock;
      sock.onopen = () => {
        if (this.sock !== sock) return;
        this.everConnected = true;
        this.attempts = 0;
        this.setStatus('open');
        this.sendHello();
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => this.send({ t: P.C.PING || 'ping', ts: performance.now() }), 2000);
        this.send({ t: P.C.PING || 'ping', ts: performance.now() });
      };
      sock.onmessage = (ev) => {
        if (this.sock !== sock) return;
        const raw = ev.data;
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { reportError('Net.parse', e); return; }
        if (!msg || typeof msg !== 'object') return;
        this.stats.recv++;
        this.stats.bytesIn += raw.length || 0;
        if (msg.t === 'snap') {
          this.stats.lastSnapBytes = raw.length || 0;
          if (this.loss && Math.random() * 100 < this.loss) { this.stats.dropped++; return; }
        }
        this.deliver(msg);
      };
      sock.onclose = () => {
        if (this.sock !== sock) return;
        this.sock = null;
        clearInterval(this._pingTimer);
        if (this.status === 'full') return;
        this.setStatus(this.everConnected ? 'lost' : 'connecting');
        this.scheduleReconnect();
      };
      sock.onerror = () => { /* onclose folgt */ };
    },

    scheduleReconnect() {
      if (this._stop) return;
      clearTimeout(this._timer);
      const delay = Math.min(5000, 600 + this.attempts * 700);
      this._timer = setTimeout(() => this.connect(), delay);
    },

    deliver(msg) {
      const run = () => {
        if (msg.t === (P.S.PONG || 'pong')) {
          this.ping = Math.max(0, Math.round(performance.now() - (+msg.ts || 0)));
          G.ping = this.ping;
          return;
        }
        if (msg.t === (P.S.ERROR || 'error') && msg.code === ((P.ERR && P.ERR.BADCODE) || 'badcode')) {
          this.badCode = true;
          this.badCodeText = msg.text || 'Raumcode nötig.';
        }
        if (msg.t === (P.S.WELCOME || 'welcome')) {
          this.badCode = false;
          this.serverRoomCode = msg.roomCode || null;
          if (msg.roomCode) this.setRoomCode(msg.roomCode, true);
        }
        if (msg.t === (P.S.FULL || 'full')) {
          this.fullText = msg.text || 'Server voll.';
          this.setStatus('full');
          this._stop = true;
          try { if (this.sock) this.sock.close(); } catch (e) { /* egal */ }
        }
        if (this.onMessage) guard('Net.onMessage(' + msg.t + ')', () => this.onMessage(msg));
      };
      if (this.lag > 0) setTimeout(run, this.lag / 2); else run();
    },

    sendHello() {
      const h = (this.getHello && guard('Net.getHello', () => this.getHello(), null)) || {};
      this.send({ t: P.C.HELLO || 'hello', clientId: this.clientId, name: h.name || 'Crew', color: h.color == null ? null : h.color, code: this.roomCode || '' });
    },

    // M0: Raumcode setzen (Eingabefeld) und merken; optional ohne neuen hello
    setRoomCode(code, silent) {
      this.roomCode = normCode(code);
      try { localStorage.setItem(CODE_KEY, this.roomCode); } catch (e) { /* egal */ }
      if (!silent && this.isOpen()) this.sendHello();
    },
    // Einladungslink: aktuelle Origin + Pfad + ?code=
    inviteLink() {
      const code = this.serverRoomCode || this.roomCode;
      const base = location.origin + location.pathname;
      return code ? base + '?code=' + encodeURIComponent(code) : base;
    },

    send(msg) {
      const sock = this.sock;
      if (!sock || sock.readyState !== 1) return false;
      if (this.loss && msg.t === 'input' && Math.random() * 100 < this.loss) { this.stats.dropped++; return false; }
      const data = JSON.stringify(msg);
      const out = () => {
        try { if (sock.readyState === 1) sock.send(data); } catch (e) { reportError('Net.send', e); }
      };
      this.stats.sent++;
      if (this.lag > 0) setTimeout(out, this.lag / 2); else out();
      return true;
    },

    isOpen() { return !!(this.sock && this.sock.readyState === 1); },
  };

  window.Net = Net;
})();
