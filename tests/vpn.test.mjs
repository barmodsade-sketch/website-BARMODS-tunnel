import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { resetRateLimitStore, VALID_ACTIONS } from '../api/vpn.js';
import { createAppServer } from '../dev-server.mjs';

const MOCK_AUTH_SECRET = 'mock_secret_auth_token_998877';
const TEST_ADMIN_PIN = '739184';
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const FORBIDDEN_DASH_PATTERN = /[\u2013\u2014]/;

function buildMockUpstreamResponse(action, searchParams, hostPort) {
  const user = searchParams.get('user') || 'guest';
  const password = searchParams.get('password') || 'pass123';
  const exp = searchParams.get('exp') || '1';
  const quota = searchParams.get('quota') || '5';
  const iplimit = searchParams.get('iplimit') || '2';
  const domain = '127.0.0.1';

  const common = {
    username: user,
    domain,
    ip: '203.0.113.25',
    cloudfront: 'd111111abcdef8.cloudfront.net',
    ns_domain: 'ns.sg1.example.com',
    pubkey: '9f86d081884c7d659a2feaa0c55ad015',
    city: 'Singapore',
    isp: 'Example Cloud',
    iplimit,
    expired: `2026-12-01 (${exp} Hari)`,
    port_host: hostPort
  };

  if (action.endsWith('ssh')) {
    return {
      status: 'success',
      data: {
        ...common,
        password,
        openssh: '22, 500',
        dropbear: '109, 143',
        ssl_tls: '443',
        ws_http: '80, 8080',
        udp_custom: '1-65535'
      }
    };
  }

  if (action.endsWith('vmess')) {
    return {
      status: 'success',
      data: {
        ...common,
        uuid: '11111111-2222-4333-8444-555555555555',
        quota,
        vmess_tls_link: `vmess://tls_mock_${user}`,
        vmess_nontls_link: `vmess://http_mock_${user}`,
        vmess_grpc_link: `vmess://grpc_mock_${user}`
      }
    };
  }

  if (action.endsWith('vless')) {
    return {
      status: 'success',
      data: {
        ...common,
        uuid: '22222222-3333-4444-8555-666666666666',
        quota,
        vless_tls_link: `vless://tls_mock_${user}@${domain}:443`,
        vless_nontls_link: `vless://http_mock_${user}@${domain}:80`,
        vless_grpc_link: `vless://grpc_mock_${user}@${domain}:443`
      }
    };
  }

  if (action.endsWith('trojan')) {
    return {
      status: 'success',
      data: {
        ...common,
        uuid: 'trojan_key_mock_999',
        quota,
        trojan_tls_link: `trojan://tls_mock_${user}@${domain}:443`,
        trojan_grpc_link: `trojan://grpc_mock_${user}@${domain}:443`
      }
    };
  }

  return {
    status: 'success',
    data: {
      ...common,
      uuid: 'ss_key_mock_888',
      cipher: '2022-blake3-aes-128-gcm',
      quota,
      ss_link_ws: `ss://ws_tls_mock_${user}@${domain}:443`,
      ss_link_nontls: `ss://ws_http_mock_${user}@${domain}:80`,
      ss_link_grpc: `ss://grpc_mock_${user}@${domain}:443`
    }
  };
}

describe('Doctor Barmods Clinical Clean Ops Console & API Suite', () => {
  let upstreamServer;
  let upstreamPort = 0;
  let appServer;
  let appBaseUrl = '';
  const recordedUpstreamCalls = [];

  before(async () => {
    upstreamServer = createServer((req, res) => {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      const action = urlObj.pathname.replace(/^\//, '');
      recordedUpstreamCalls.push({
        action,
        params: Object.fromEntries(urlObj.searchParams.entries())
      });

      if (urlObj.searchParams.get('auth') !== MOCK_AUTH_SECRET) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'error', message: 'Invalid node auth' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(buildMockUpstreamResponse(action, urlObj.searchParams, upstreamPort)));
    });

    await new Promise((resolve) => {
      upstreamServer.listen(0, '127.0.0.1', () => {
        upstreamPort = upstreamServer.address().port;
        resolve();
      });
    });

    appServer = createAppServer();
    await new Promise((resolve) => {
      appServer.listen(0, '127.0.0.1', () => {
        const port = appServer.address().port;
        appBaseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => upstreamServer.close(resolve));
  });

  beforeEach(() => {
    recordedUpstreamCalls.length = 0;
    resetRateLimitStore();
    process.env.VPN_SERVERS_JSON = JSON.stringify([
      {
        id: 'sg-mock-01',
        name: 'Singapore Clinical Node 01',
        region: 'Singapore',
        isp: 'Example Cloud',
        domain: '127.0.0.1',
        port: upstreamPort,
        auth: MOCK_AUTH_SECRET
      }
    ]);
    process.env.ADMIN_PIN = TEST_ADMIN_PIN;
    process.env.TRIAL_RATE_LIMIT_MAX = '5';
  });

  it('serves index.html and brand SVG with Konoha signature, dual theme tokens, and zero emojis', async () => {
    const htmlRes = await fetch(`${appBaseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();

    assert.match(html, /<html lang="id"/);
    assert.match(html, /<meta name="generator" content="Build by konoha">/);
    assert.match(html, /Build by konoha/);
    assert.match(html, /--bg-canvas:\s*#F4F7F6/i);
    assert.match(html, /--bg-canvas:\s*#0B1211/i);
    assert.equal(EMOJI_PATTERN.test(html), false);
    assert.equal(FORBIDDEN_DASH_PATTERN.test(html), false);

    const svgRes = await fetch(`${appBaseUrl}/barmods-rx-mark.svg`);
    assert.equal(svgRes.status, 200);
    assert.match(svgRes.headers.get('content-type') || '', /image\/svg\+xml/);
    const svgText = await svgRes.text();
    assert.match(svgText, /<svg/);
  });

  it('handles GET /api/vpn safely when unconfigured and redacts auth secrets when configured', async () => {
    delete process.env.VPN_SERVERS_JSON;
    const emptyRes = await fetch(`${appBaseUrl}/api/vpn`);
    assert.equal(emptyRes.status, 200);
    const emptyBody = await emptyRes.json();
    assert.equal(emptyBody.configured, false);
    assert.deepEqual(emptyBody.servers, []);

    process.env.VPN_SERVERS_JSON = JSON.stringify([
      {
        id: 'sg-mock-01',
        name: 'Singapore Clinical Node 01',
        region: 'Singapore',
        isp: 'Example Cloud',
        domain: '127.0.0.1',
        port: upstreamPort,
        auth: MOCK_AUTH_SECRET
      }
    ]);

    const readyRes = await fetch(`${appBaseUrl}/api/vpn`);
    assert.equal(readyRes.status, 200);
    const rawText = await readyRes.text();
    assert.equal(rawText.includes(MOCK_AUTH_SECRET), false, 'auth token must never appear in GET /api/vpn');

    const parsed = JSON.parse(rawText);
    assert.equal(parsed.configured, true);
    assert.equal(parsed.servers.length, 1);
    assert.equal(parsed.servers[0].id, 'sg-mock-01');
    assert.equal('auth' in parsed.servers[0], false);
  });

  it('provisions all 10 actions accurately and maps protocol links, DNS telemetry, and .txt save URLs', async () => {
    assert.equal(VALID_ACTIONS.length, 10);

    for (const action of VALID_ACTIONS) {
      resetRateLimitStore();
      const isPremium = action.startsWith('create');
      const isSsh = action.endsWith('ssh');
      const user = `usr${action}`;

      const reqBody = {
        action,
        serverId: 'sg-mock-01',
        user
      };
      if (isSsh) {
        reqBody.password = 'SecPass99';
      }
      if (isPremium) {
        reqBody.exp = 30;
        reqBody.iplimit = 4;
        if (!isSsh) reqBody.quota = 0;
        reqBody.adminPin = TEST_ADMIN_PIN;
      }

      const res = await fetch(`${appBaseUrl}/api/vpn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.10'
        },
        body: JSON.stringify(reqBody)
      });

      assert.equal(res.status, 200, `Expected HTTP 200 for ${action}`);
      const data = await res.json();
      assert.equal(data.status, 'success');
      assert.equal(data.action, action);
      assert.equal(data.account.username, user);
      assert.equal(data.server.cloudfront, 'd111111abcdef8.cloudfront.net');
      assert.equal(data.server.ns_domain, 'ns.sg1.example.com');
      assert.equal(data.server.pubkey, '9f86d081884c7d659a2feaa0c55ad015');
      assert.equal(
        data.rawLinks.save_txt,
        `http://127.0.0.1:81/${data.protocol}-${user}.txt`
      );
      assert.equal(EMOJI_PATTERN.test(data.reportText), false);
      assert.equal(FORBIDDEN_DASH_PATTERN.test(data.reportText), false);

      const upstreamHit = recordedUpstreamCalls.at(-1);
      assert.equal(upstreamHit.action, action);
      assert.equal(upstreamHit.params.user, user);
      assert.equal(upstreamHit.params.auth, MOCK_AUTH_SECRET);

      if (isSsh) {
        assert.equal(upstreamHit.params.password, 'SecPass99');
        assert.equal('quota' in upstreamHit.params, false);
      } else {
        assert.equal('password' in upstreamHit.params, false);
        assert.equal(upstreamHit.params.quota, isPremium ? '0' : '5');
      }

      if (data.protocol === 'vmess') {
        assert.equal(data.rawLinks.vmess_tls_link, `vmess://tls_mock_${user}`);
        assert.equal(data.rawLinks.vmess_nontls_link, `vmess://http_mock_${user}`);
        assert.equal(data.rawLinks.vmess_grpc_link, `vmess://grpc_mock_${user}`);
      } else if (data.protocol === 'vless') {
        assert.match(data.rawLinks.vless_tls_link, /^vless:\/\/tls_mock_/);
        assert.match(data.rawLinks.vless_nontls_link, /^vless:\/\/http_mock_/);
        assert.match(data.rawLinks.vless_grpc_link, /^vless:\/\/grpc_mock_/);
      } else if (data.protocol === 'trojan') {
        assert.match(data.rawLinks.trojan_tls_link, /^trojan:\/\/tls_mock_/);
        assert.match(data.rawLinks.trojan_grpc_link, /^trojan:\/\/grpc_mock_/);
      } else if (data.protocol === 'shadowsocks') {
        assert.match(data.rawLinks.ss_link_ws, /^ss:\/\/ws_tls_mock_/);
        assert.match(data.rawLinks.ss_link_nontls, /^ss:\/\/ws_http_mock_/);
        assert.match(data.rawLinks.ss_link_grpc, /^ss:\/\/grpc_mock_/);
      }
    }
  });

  it('enforces strict alphanumeric username validation', async () => {
    for (const invalidUser of ['bad user', '../etc/passwd', 'user;id', '']) {
      const res = await fetch(`${appBaseUrl}/api/vpn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'trialvmess',
          serverId: 'sg-mock-01',
          user: invalidUser
        })
      });
      assert.equal(res.status, 400);
    }
  });

  it('enforces ADMIN_PIN with 503 when unset and timing-safe 401 when mismatched', async () => {
    delete process.env.ADMIN_PIN;
    const unsetRes = await fetch(`${appBaseUrl}/api/vpn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createvless',
        serverId: 'sg-mock-01',
        user: 'prem01',
        exp: 30,
        quota: 100,
        iplimit: 2,
        adminPin: TEST_ADMIN_PIN
      })
    });
    assert.equal(unsetRes.status, 503);

    process.env.ADMIN_PIN = TEST_ADMIN_PIN;
    const wrongPinRes = await fetch(`${appBaseUrl}/api/vpn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createvless',
        serverId: 'sg-mock-01',
        user: 'prem01',
        exp: 30,
        quota: 100,
        iplimit: 2,
        adminPin: 'wrong_length_pin_value'
      })
    });
    assert.equal(wrongPinRes.status, 401);
  });

  it('clamps public trial parameters safely and enforces sliding-window IP rate limiting', async () => {
    process.env.TRIAL_RATE_LIMIT_MAX = '2';

    const firstRes = await fetch(`${appBaseUrl}/api/vpn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.77'
      },
      body: JSON.stringify({
        action: 'trialvmess',
        serverId: 'sg-mock-01',
        user: 'clampcheck1',
        exp: 365,
        quota: 0,
        iplimit: 50
      })
    });
    assert.equal(firstRes.status, 200);
    const clampedCall = recordedUpstreamCalls.at(-1);
    assert.equal(clampedCall.params.exp, '1');
    assert.equal(clampedCall.params.quota, '5');
    assert.equal(clampedCall.params.iplimit, '2');

    const secondRes = await fetch(`${appBaseUrl}/api/vpn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.77'
      },
      body: JSON.stringify({
        action: 'trialvless',
        serverId: 'sg-mock-01',
        user: 'clampcheck2'
      })
    });
    assert.equal(secondRes.status, 200);

    const thirdRes = await fetch(`${appBaseUrl}/api/vpn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.77'
      },
      body: JSON.stringify({
        action: 'trialtrojan',
        serverId: 'sg-mock-01',
        user: 'clampcheck3'
      })
    });
    assert.equal(thirdRes.status, 429);
    assert.ok(Number(thirdRes.headers.get('retry-after')) >= 1);

    const otherIpRes = await fetch(`${appBaseUrl}/api/vpn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.88'
      },
      body: JSON.stringify({
        action: 'trialtrojan',
        serverId: 'sg-mock-01',
        user: 'otherip1'
      })
    });
    assert.equal(otherIpRes.status, 200);
  });
});
