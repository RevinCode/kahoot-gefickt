#!/usr/bin/env python3
"""Fast proxy tester - tests 50 at a time, stops after finding enough."""
import asyncio, json, sys, time, random
import httpx

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
PIN = "228486"
TIMEOUT = 5
NEED = 25

async def test(proxy, client):
    try:
        ts = int(time.time() * 1000)
        r = await client.get(
            f"https://kahoot.it/reserve/session/{PIN}/?{ts}",
            headers={"User-Agent": UA},
            proxy=proxy,
            timeout=TIMEOUT,
        )
        body = r.json()
        token = r.headers.get("x-kahoot-session-token", "")
        if body.get("challenge") and token:
            return proxy
    except:
        pass
    return None

async def main():
    with open("/tmp/flashproxies.txt") as f:
        proxies = [l.strip() for l in f if l.strip()]
    
    random.shuffle(proxies)
    # take first 300 max
    proxies = proxies[:300]
    print(f"Testing {len(proxies)} proxies (batch 50, stop at {NEED})...")
    
    found = []
    async with httpx.AsyncClient(verify=False) as client:
        for i in range(0, len(proxies), 50):
            batch = proxies[i:i+50]
            tasks = [test(p, client) for p in batch]
            results = await asyncio.gather(*tasks)
            for r in results:
                if r:
                    found.append(r)
                    print(f"  + {r}")
            print(f"  batch done: {len(found)} found")
            if len(found) >= NEED:
                break
    
    print(f"\n=== {len(found)} working proxies ===")
    with open("/home/revin/kahoot-server/proxies.json", "w") as f:
        json.dump(found, f, indent=2)
    print("Saved to proxies.json")

asyncio.run(main())
