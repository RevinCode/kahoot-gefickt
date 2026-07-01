#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const TIMEOUT = 6000;
const PIN = '228486';

async function testProxy(proxyUrl) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), TIMEOUT);
        try {
            let agent;
            if (proxyUrl.startsWith('socks')) {
                agent = new SocksProxyAgent(proxyUrl);
            } else {
                agent = new HttpsProxyAgent(proxyUrl);
            }
            const ts = Date.now();
            const req = https.get({
                hostname: 'kahoot.it',
                path: `/reserve/session/${PIN}/?${ts}`,
                headers: { 'User-Agent': UA },
                agent,
                timeout: TIMEOUT,
            }, (res) => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => {
                    clearTimeout(timer);
                    try {
                        const body = JSON.parse(data);
                        const token = res.headers['x-kahoot-session-token'];
                        if (body.challenge && token) {
                            resolve({ proxy: proxyUrl, tokenLen: token.length });
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => { clearTimeout(timer); resolve(null); });
            req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve(null); });
        } catch (e) {
            clearTimeout(timer);
            resolve(null);
        }
    });
}

async function main() {
    const files = process.argv.slice(2);
    let allProxies = [];
    for (const f of files) {
        const lines = fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim());
        allProxies.push(...lines);
    }
    console.log(`Testing ${allProxies.length} proxies...`);

    // Shuffle
    for (let i = allProxies.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allProxies[i], allProxies[j]] = [allProxies[j], allProxies[i]];
    }

    const working = [];
    const BATCH = 20;

    for (let i = 0; i < allProxies.length && working.length < 30; i += BATCH) {
        const batch = allProxies.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(p => testProxy(p)));
        for (const r of results) {
            if (r) {
                working.push(r);
                console.log(`  + ${r.proxy} (token: ${r.tokenLen})`);
            }
        }
        if (i % 60 === 0) console.log(`... ${working.length} found so far`);
    }

    console.log(`\n=== ${working.length} working proxies ===`);
    const proxies = working.map(w => w.proxy);
    fs.writeFileSync('/home/revin/kahoot-server/proxies.json', JSON.stringify(proxies, null, 2));
    console.log('Saved to proxies.json');
}

main().catch(e => { console.error(e); process.exit(1); });
