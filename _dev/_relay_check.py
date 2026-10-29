"""Which candidate-shaped messages does the public PeerJS server forward intact?"""
import asyncio, json, secrets
from websockets.asyncio.client import connect

def url(i):
    return f"wss://0.peerjs.com/peerjs?key=peerjs&id={i}&token={secrets.token_hex(5)}&version=1.5.4"

def cand(text, extra=None, conn="dc_tq"):
    p = {"candidate": {"candidate": text, "sdpMid": "0", "sdpMLineIndex": 0}, "type": "data", "connectionId": conn}
    if extra:
        p.update(extra)
    return p

async def main():
    a_id, b_id = "vinny-teamquiz-ra-" + secrets.token_hex(4), "vinny-teamquiz-rb-" + secrets.token_hex(4)
    a = await connect(url(a_id), open_timeout=15); await a.recv()
    b = await connect(url(b_id), open_timeout=15); await b.recv()
    game = json.dumps({"k": "d", "id": "abc", "d": {"t": "question", "texts": ["Jupiter", "Saturn", "Neptune", "Uranus"], "text": "Which planet is this?"}})
    variants = [
        ("extra field in payload", cand("", {"tq": {"k": "hi"}})),
        ("data in candidate string", cand("tq:" + game)),
        ("2 KB in candidate string", cand("tq:" + "x" * 2000)),
        ("8 KB in candidate string", cand("tq:" + "x" * 8000)),
        ("30 KB in candidate string", cand("tq:" + "x" * 30000)),
        ("own connectionId", cand("tq:" + game, conn="tq_abc123")),
    ]
    n = 0
    for name, payload in variants:
        n += 1
        try:
            await a.send(json.dumps({"type": "CANDIDATE", "dst": b_id, "payload": payload}))
            got = json.loads(await asyncio.wait_for(b.recv(), 6))
            pl = got.get("payload", {})
            same = pl == payload
            print(f"{name:27} -> forwarded, intact={same}, src={got.get('src') == a_id}" + ("" if same else f" got={json.dumps(pl)[:120]}"))
        except asyncio.TimeoutError:
            print(f"{name:27} -> NOT forwarded")
        except Exception as e:
            print(f"{name:27} -> ERROR {type(e).__name__}")
        try:
            await a.send(json.dumps({"type": "HEARTBEAT"})); await asyncio.sleep(0.8)
            if a.state.name != "OPEN":
                raise RuntimeError(a.state.name)
        except Exception:
            print("   sender was disconnected; reconnecting")
            a_id = "vinny-teamquiz-ra-" + secrets.token_hex(4)
            a = await connect(url(a_id), open_timeout=15); await a.recv()
    await a.close(); await b.close()

asyncio.run(main())
