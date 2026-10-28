"""Check the Zoom invite link works when the host page is opened as /host.html AND as Netlify's short /host."""
import pathlib, re, threading, http.server, functools, socketserver
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):                     # mimic Netlify: /host serves host.html
        if self.path.split("?")[0] == "/host":
            self.path = "/host.html" + self.path[5:]
        return super().do_GET()
    def log_message(self, *a):
        pass

srv = socketserver.TCPServer(("127.0.0.1", 8766), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
    for path in ["/host.html", "/host"]:
        ctx = b.new_context()
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://127.0.0.1:8766")
        h = ctx.new_page()
        h.goto("http://127.0.0.1:8766" + path)
        h.click("#btn-sample")
        h.wait_for_selector(".quiz-card")
        h.click(".quiz-card button[data-act=play]")
        h.wait_for_function("/^\\d{6}$/.test(document.getElementById('join-code').textContent)", timeout=30000)
        h.click("#btn-copy-invite")
        h.wait_for_timeout(500)
        invite = h.evaluate("navigator.clipboard.readText()")
        link = re.search(r"https?://\S+", invite).group(0)
        pl = ctx.new_page()
        resp = pl.goto(link)
        pl.wait_for_selector("#scr-join:not([hidden])", timeout=10000)
        print(f"host at {path:11} -> invite link {link} -> HTTP {resp.status}, join form shown with PIN {pl.inner_text('#pin-show')}")
        ctx.close()
    b.close()
srv.shutdown()
