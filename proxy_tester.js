#!/usr/bin/env node
/**
 * Proxy tester - tests SOCKS5 proxies against Kahoot session endpoint.
 * Usage: node proxy_tester.js
 * Returns: working proxy list file
 */
const fs = require('fs');
const https = require('https');
const http = require('http');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PROXY_FILE = '/tmp/socks5_ps.txt';
const OUTPUT_FILE = '/home/revin/kahoot-server/proxies.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const TIMEOUT = 8000;
const TARGET_COUNT = 25;

async function testProxy(proxyUrl) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), TIMEOUT);
        try {
            const agent = new SocksProxyAgent(proxyUrl);
            const ts = Date.now();
            const req = https.get({
                hostname: 'kahoot.it',
                path: `/reserve/session/228486/?${ts}`,
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
                            resolve({ proxy: proxyUrl, status: res.statusCode, tokenLen: token.length });
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
            resolve(null);
        }
    });
}

async function main() {
    const lines = fs.readFileSync(PROXY_FILE, 'utf8').split('\n').filter(l => l.trim());
    console.log(`Testing ${lines.length} SOCKS5 proxies... (need ${TARGET_COUNT} working)`);

    // Shuffle
    for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
    }

    const working = [];
    const BATCH = 30;

    for (let i = 0; i < lines.length && working.length < TARGET_COUNT; i += BATCH) {
        const batch = lines.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(p => testProxy(p)));
        for (const r of results) {
            if (r) {
                working.push(r);
                process.stdout.write('+');
            }
        }
        process.stdout.write(` (${working.length}/${TARGET_COUNT})\n`);
    }

    console.log(`\nFound ${working.length} working proxies:`);
    working.forEach(w => console.log(`  ${w.proxy} (token: ${w.tokenLen} chars)`));

    // Save as JSON
    const proxies = working.map(w => w.proxy);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(proxies, null, 2));
    console.log(`\nSaved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
