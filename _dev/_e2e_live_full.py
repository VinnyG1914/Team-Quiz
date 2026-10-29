"""End-to-end test: 1 host + 3 players (2 phones, 1 laptop) play the sample quiz over real PeerJS/WebRTC.
Run from the TeamQuiz folder with `python -m http.server 8765 --bind 127.0.0.1` serving it."""
import time, pathlib
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/"
SHOTS = pathlib.Path(__file__).parent / "_shots"
SHOTS.mkdir(exist_ok=True)
CORRECT = [1, 0, 2, 0, 1]          # sample quiz answers
# Simulate a company network that blocks direct WebRTC links: every RTCPeerConnection is forced to
# relay-only with no relay servers, so it can never connect. The game must still work.
BLOCK_RTC = """

(() => { const R = window.RTCPeerConnection; if (!R) return;
  window.__rtcMade = 0;
  window.RTCPeerConnection = function (cfg) { window.__rtcMade++; return new R(Object.assign({}, cfg || {}, { iceServers: [], iceTransportPolicy: 'relay' })); };
  window.RTCPeerConnection.prototype = R.prototype; })();
"""
_orig_new_context = None
def _patch(browser):
    orig = browser.new_context
    def nc(*a, **k):
        ctx = orig(*a, **k)
        ctx.add_init_script(BLOCK_RTC)
        return ctx
    browser.new_context = nc
    return browser
errors = []

def log(*a):
    print(*a, flush=True)

def watch(page, tag):
    page.on("pageerror", lambda e: errors.append(f"{tag} pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"{tag} console.{m.type}: {m.text}") if m.type == "error" else None)

with sync_playwright() as p:
    b = _patch(p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"]))
    hctx = b.new_context(viewport={"width": 1366, "height": 768})
    host = hctx.new_page(); watch(host, "host")
    host.on("dialog", lambda d: d.accept())
    host.goto(BASE + "host.html")
    host.click("#btn-sample")
    host.wait_for_selector(".quiz-card")
    time.sleep(1.5)
    host.screenshot(path=str(SHOTS / "01_library.png"))
    host.click(".quiz-card button[data-act=play]")
    host.wait_for_function("/^\\d{6}$/.test(document.getElementById('join-code').textContent)", timeout=30000)
    host.evaluate("TQ_CONFIG.previewSeconds = 2")
    pin = host.inner_text("#join-code").strip()
    log("PIN", pin, "| net:", host.inner_text("#net"))

    players = []
    setups = [("Alice", "phone", 0, 2), ("Bob", "laptop", 1, 5), ("Chris", "phone", 4, 3)]
    for name, kind, tabi, avi in setups:
        if kind == "phone":
            ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        else:
            ctx = b.new_context(viewport={"width": 1280, "height": 760})
        pg = ctx.new_page(); watch(pg, name)
        pg.goto(BASE + "index.html?pin=" + pin)
        pg.wait_for_selector("#scr-join:not([hidden])")
        pg.fill("#in-name", name)
        pg.click(f"#av-tabs button[data-tab='{tabi}']")
        pg.click(f"#av-grid button:nth-child({avi})")
        pg.click(f"#col-grid button:nth-child({avi})")
        if name == "Alice":
            time.sleep(0.8)
            pg.screenshot(path=str(SHOTS / "02_player_join.png"))
        pg.click("#btn-join")
        players.append(pg)
    for pg in players:
        pg.wait_for_selector("text=You're in!", timeout=30000)
    host.wait_for_function("document.getElementById('player-count').textContent === '3'", timeout=10000)
    log("lobby players:", host.inner_text("#players").replace("\n", " | "))
    imgs_ok = host.evaluate("[...document.querySelectorAll('#players img')].every(i => i.complete && i.naturalWidth > 0)")
    log("lobby avatar images loaded:", imgs_ok)
    time.sleep(1)
    host.screenshot(path=str(SHOTS / "03_lobby.png"))
    players[0].screenshot(path=str(SHOTS / "04_player_lobby.png"))

    host.click("#btn-start", force=True)   # the button pulses, so Playwright never sees it as "stable"
    host.wait_for_selector("#scr-intro:not([hidden])")
    time.sleep(1.2)
    host.screenshot(path=str(SHOTS / "05_intro.png"))
    host.wait_for_selector("#scr-preview:not([hidden])", timeout=10000)
    time.sleep(0.9)
    host.screenshot(path=str(SHOTS / "06_preview.png"))
    players[1].screenshot(path=str(SHOTS / "07_laptop_ready.png"))
    for qi, corr in enumerate(CORRECT):
        for pg in players:
            pg.wait_for_selector("#scr-question:not([hidden]) #q-answers button", timeout=20000)
        host.wait_for_selector("#scr-question:not([hidden])")
        if qi == 0:
            time.sleep(2.0)
            log("laptop shows question text:", players[1].is_visible("#q-text"), "| answer text:",
                players[1].is_visible("#q-answers .t"), "->", players[1].inner_text("#q-answers").replace("\n", " / "))
            log("phone shows question text:", players[0].is_visible("#q-text"), "| answer text:", players[0].is_visible("#q-answers .t"))
            host.screenshot(path=str(SHOTS / "08_host_question.png"))
            players[0].screenshot(path=str(SHOTS / "09_phone_question.png"))
            players[1].screenshot(path=str(SHOTS / "10_laptop_question.png"))
        n = players[0].locator("#q-answers button").count()
        wrong = (corr + 1) % n
        players[0].click(f"#q-answers button[data-j='{corr}']")          # Alice: fast + right
        time.sleep(1.5)
        players[1].click(f"#q-answers button[data-j='{wrong}']")         # Bob: wrong
        time.sleep(1.0)
        if qi != 2:
            players[2].click(f"#q-answers button[data-j='{corr}']")      # Chris: slower + right, skips Q3
        host.wait_for_selector("#scr-reveal:not([hidden])", timeout=40000)
        for pg in players:
            pg.wait_for_selector("#scr-result:not([hidden])", timeout=10000)
        time.sleep(1.3)
        res = [pg.inner_text("#r-body").replace("\n", " / ") for pg in players]
        log(f"Q{qi + 1} results:", res)
        if qi == 0:
            host.screenshot(path=str(SHOTS / "11_host_reveal.png"))
            players[0].screenshot(path=str(SHOTS / "12_phone_correct.png"))
            players[1].screenshot(path=str(SHOTS / "13_laptop_wrong.png"))
        host.click("#rv-next")
        if qi < len(CORRECT) - 1:
            host.wait_for_selector("#scr-scoreboard:not([hidden])")
            if qi == 3:
                time.sleep(0.4)
                host.screenshot(path=str(SHOTS / "14_scoreboard_moving.png"))
            time.sleep(2.2)
            log("  scoreboard:", host.inner_text("#sb-list").replace("\n", " "))
            if qi == 3:
                host.screenshot(path=str(SHOTS / "15_scoreboard.png"))
            if qi == 1:
                before = players[2].inner_text("#w-score")
                players[2].reload()
                players[2].wait_for_selector("#scr-join:not([hidden])")
                players[2].click("#btn-join")
                players[2].wait_for_selector("#scr-wait:not([hidden]) >> text=points", timeout=30000)
                after = players[2].inner_text("#w-score")
                log(f"  Chris refresh: score before={before} after={after}")
                assert before == after, "score lost after refresh"
                host.wait_for_function("Object.values(window.__tqHost.game.players).filter(p=>p.connected).length===3", timeout=10000)
            host.click("#sb-next")
    host.wait_for_selector("#scr-podium:not([hidden])")
    time.sleep(3.2)
    host.screenshot(path=str(SHOTS / "16_podium_partial.png"))
    time.sleep(5.5)
    host.screenshot(path=str(SHOTS / "17_podium.png"))
    for pg, nm in zip(players, ["Alice", "Bob", "Chris"]):
        pg.wait_for_selector("text=You finished", timeout=10000)
        log(nm, "end:", pg.inner_text("#w-body").replace("\n", " / "))
    players[2].screenshot(path=str(SHOTS / "18_player_end.png"))
    g = host.evaluate("Object.values(window.__tqHost.game.players).map(p=>({n:p.name,s:p.score,c:p.correctCount,h:p.history.map(x=>x&&x.pts)}))")
    log("final host state:", g)
    b.close()

log("ERRORS:", len(errors))
for e in errors:
    log("  ", e)
