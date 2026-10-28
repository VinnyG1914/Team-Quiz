"""Live check against the real public PeerJS server (0.peerjs.com), with direct WebRTC blocked.
Uses the real app pages: host opens a lobby, one player joins and should see "You're in!"."""
from playwright.sync_api import sync_playwright

BLOCK = """(() => { const R = window.RTCPeerConnection; if (!R) return;
  window.RTCPeerConnection = function (c) { return new R(Object.assign({}, c || {}, { iceServers: [], iceTransportPolicy: 'relay' })); };
  window.RTCPeerConnection.prototype = R.prototype; })();"""
with sync_playwright() as p:
    b = p.chromium.launch()
    hc = b.new_context(); hc.add_init_script(BLOCK); h = hc.new_page()
    h.on("dialog", lambda d: d.accept())
    h.goto("http://127.0.0.1:8765/host.html")
    h.click("#btn-sample"); h.wait_for_selector(".quiz-card")
    h.click(".quiz-card button[data-act=play]")
    try:
        h.wait_for_function("/^\\d{6}$/.test(document.getElementById('join-code').textContent)", timeout=30000)
    except Exception:
        print("host could not open a room:", h.inner_text("#net")); b.close(); raise SystemExit
    pin = h.inner_text("#join-code")
    pc = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); pc.add_init_script(BLOCK)
    pl = pc.new_page()
    pl.goto("http://127.0.0.1:8765/?pin=" + pin)
    pl.fill("#in-name", "LiveTest"); pl.click("#btn-join")
    try:
        pl.wait_for_selector("text=You're in!", timeout=30000)
        h.wait_for_function("document.getElementById('player-count').textContent === '1'", timeout=10000)
        print("LIVE OK: player joined through the public server with direct WebRTC blocked. PIN", pin)
    except Exception:
        print("LIVE FAIL: player screen says:", pl.inner_text("body")[:300].replace("\n", " / "))
    h.click("#lobby-back")
    b.close()
