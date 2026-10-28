"""Paste-from-Claude import, editor render, and host refresh/resume with a player reconnecting."""
import time, pathlib
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/"
SHOTS = pathlib.Path(__file__).parent / "_shots"
SHOTS.mkdir(exist_ok=True)
# Simulate a company network that blocks direct WebRTC links: every RTCPeerConnection is forced to
# relay-only with no relay servers, so it can never connect. The game must still work.
BLOCK_RTC = """
window.TQ_TEST_PEER = { host: '127.0.0.1', port: 9000, path: '/', secure: false };
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
CLAUDE_REPLY = '''Here is your quiz!

```json
{
  "title": "Office Fun Friday", "theme": "party",
  "questions": [
    { "type": "quiz", "question": "Which country invented tea bags?", "answers": ["UK", "USA", "China", "India"], "correct": "B", "time": 20 },
    { "type": "truefalse", "question": "Bananas are berries.", "correct": true, "time": 10 },
    { "type": "quiz", "question": "Pick the prime numbers", "answers": ["2", "4", "7", "9"], "correct": ["A", "C"], "time": 20, "points": "double" },
    { "type": "quiz", "question": "Broken one", "answers": ["only one"], "correct": "A" }
  ]
}
```
Enjoy!'''

def watch(page, tag):
    page.on("pageerror", lambda e: errors.append(f"{tag} pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"{tag} console.error: {m.text}") if m.type == "error" else None)

with sync_playwright() as p:
    b = _patch(p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"]))
    hctx = b.new_context(viewport={"width": 1280, "height": 900})
    host = hctx.new_page(); watch(host, "host")
    host.on("dialog", lambda d: d.accept())
    host.goto(BASE + "host.html")
    host.click("#btn-paste")
    host.fill("#paste-text", CLAUDE_REPLY)
    host.click("#paste-ok")
    host.wait_for_selector(".quiz-card >> text=Office Fun Friday")
    print("toast:", host.inner_text(".toast").replace("\n", " | "))
    print("card:", host.inner_text(".quiz-card").replace("\n", " | "))
    host.click(".quiz-card button[data-act=edit]")
    host.wait_for_selector("#scr-editor:not([hidden]) .q-card")
    print("editor cards:", host.locator(".q-card").count(),
          "| Q3 ticks:", host.eval_on_selector_all(".q-card:nth-child(3) input[data-f=corr]", "els=>els.map(e=>e.checked)"))
    # break question 1, try to save -> validation error
    host.fill(".q-card:nth-child(1) textarea", "")
    host.click("#ed-save")
    time.sleep(0.4)
    print("validation:", host.inner_text(".q-card.error .err-text"))
    host.fill(".q-card:nth-child(1) textarea", "Which country invented tea bags?")
    print("imported theme selected in editor:", host.get_attribute("#ed-themes .theme.sel", "data-theme"))
    host.click("#ed-themes .theme[data-theme='beach']")
    time.sleep(1.6)
    host.screenshot(path=str(SHOTS / "19_editor.png"), full_page=False)
    host.click("#ed-save")
    time.sleep(0.5)
    print("saved errors:", host.locator(".q-card.error").count())
    host.click("#ed-back")

    # host a game, one player joins and answers Q1, then the host tab reloads
    host.click(".quiz-card button[data-act=play]")
    host.wait_for_function("/^\\d{6}$/.test(document.getElementById('join-code').textContent)", timeout=30000)
    host.evaluate("TQ_CONFIG.previewSeconds = 1")
    pin = host.inner_text("#join-code").strip()
    pctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pl = pctx.new_page(); watch(pl, "player")
    pl.goto(BASE + "index.html?pin=" + pin)
    pl.fill("#in-name", "Dana")
    pl.click("#btn-join")
    pl.wait_for_selector("text=You're in!", timeout=30000)
    host.click("#btn-start", force=True)
    pl.wait_for_selector("#scr-question:not([hidden]) #q-answers button", timeout=20000)
    pl.click("#q-answers button[data-j='1']")
    host.wait_for_selector("#scr-reveal:not([hidden])", timeout=20000)
    pl.wait_for_selector("#scr-result:not([hidden])")
    time.sleep(1.3)   # let the score count-up animation finish
    score_before = pl.inner_text("#r-score")
    print("Dana after Q1:", score_before)

    host.reload()
    host.wait_for_selector("#resume-banner:not([hidden])")
    print("banner:", host.inner_text("#resume-banner").replace("\n", " "))
    host.click("#rs-go")
    host.wait_for_function(f"document.getElementById('join-code').textContent === '{pin}'", timeout=90000)
    host.evaluate("TQ_CONFIG.previewSeconds = 1")
    print("resumed with same PIN; net:", host.inner_text("#net"))
    host.wait_for_function("document.getElementById('player-count').textContent === '1'", timeout=60000)
    print("Dana reconnected automatically; start button:", host.inner_text("#btn-start"))
    host.click("#btn-start", force=True)
    pl.wait_for_selector("#scr-question:not([hidden]) #q-answers button", timeout=20000)
    print("Dana sees question", pl.inner_text("#q-progress"), "| score", pl.inner_text("#q-score"))
    print("player backdrop:", pl.evaluate("[...document.querySelectorAll('#backdrop .bd-img.on')].map(e=>e.style.backgroundImage).join()"))
    print("saved theme:", host.evaluate("TQ.Store.all().then(l=>l.map(q=>q.theme).join())"))
    assert pl.inner_text("#q-score") == score_before
    b.close()

print("ERRORS:", len(errors))
for e in errors:
    print("  ", e)
