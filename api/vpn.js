import { createHash, timingSafeEqual } from 'node:crypto';

const UPSTREAM_TIMEOUT_MS = 15000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_TRIAL_LIMIT = 5;
const MAX_BODY_BYTES = 16384;
const USERNAME_PATTERN = /^[a-zA-Z0-9]+$/;
const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]+$/;

const ACTION_SPECS = Object.freeze({
  trialssh: { tier: 'trial', protocol: 'ssh', needsPassword: true, needsQuota: false },
  trialvmess: { tier: 'trial', protocol: 'vmess', needsPassword: false, needsQuota: true },
  trialvless: { tier: 'trial', protocol: 'vless', needsPassword: false, needsQuota: true },
  trialtrojan: { tier: 'trial', protocol: 'trojan', needsPassword: false, needsQuota: true },
  trialshadowsocks: { tier: 'trial', protocol: 'shadowsocks', needsPassword: false, needsQuota: true },
  createssh: { tier: 'premium', protocol: 'ssh', needsPassword: true, needsQuota: false },
  createvmess: { tier: 'premium', protocol: 'vmess', needsPassword: false, needsQuota: true },
  createvless: { tier: 'premium', protocol: 'vless', needsPassword: false, needsQuota: true },
  createtrojan: { tier: 'premium', protocol: 'trojan', needsPassword: false, needsQuota: true },
  createshadowsocks: { tier: 'premium', protocol: 'shadowsocks', needsPassword: false, needsQuota: true }
});

const XRAY_PROTO_CONFIG = Object.freeze({
  vmess: {
    path: '/vmess', grpc: 'vmess-grpc', cipher: 'auto (alterId 0)', secret: ['uuid', 'id'],
    tls: ['vmess_tls_link', 'link_tls', 'vmesslink1'], http: ['vmess_nontls_link', 'link_nontls', 'vmesslink2'],
    grpcKeys: ['vmess_grpc_link', 'link_grpc', 'vmesslink3'],
    rawNames: ['vmess_tls_link', 'vmess_nontls_link', 'vmess_grpc_link'], tlsLabel: 'URL TLS (Port 443)', httpLabel: 'URL HTTP (Port 80)'
  },
  vless: {
    path: '/vless', grpc: 'vless-grpc', cipher: 'none', secret: ['uuid', 'id'],
    tls: ['vless_tls_link', 'link_tls', 'vlesslink1'], http: ['vless_nontls_link', 'link_nontls', 'vlesslink2'],
    grpcKeys: ['vless_grpc_link', 'link_grpc', 'vlesslink3'],
    rawNames: ['vless_tls_link', 'vless_nontls_link', 'vless_grpc_link'], tlsLabel: 'URL TLS (Port 443)', httpLabel: 'URL HTTP (Port 80)'
  },
  trojan: {
    path: '/trojan-ws', grpc: 'trojan-grpc', cipher: 'TLS 1.3 / Trojan', secret: ['uuid', 'key', 'password'],
    tls: ['trojan_tls_link', 'link_tls', 'trojanlink1'], http: ['trojan_nontls_link', 'trojan_ws_link', 'link_nontls'],
    grpcKeys: ['trojan_grpc_link', 'link_grpc', 'trojanlink2'],
    rawNames: ['trojan_tls_link', 'trojan_nontls_link', 'trojan_grpc_link'], tlsLabel: 'URL TLS (Port 443)', httpLabel: 'URL HTTP (Port 80)'
  },
  shadowsocks: {
    path: '/ss-ws', grpc: 'ss-grpc', cipher: 'aes-128-gcm', secret: ['uuid', 'password', 'key'],
    tls: ['ss_link_ws', 'ss_tls_link', 'link_tls'], http: ['ss_link_nontls', 'link_nontls'],
    grpcKeys: ['ss_link_grpc', 'link_grpc'],
    rawNames: ['ss_link_ws', 'ss_link_nontls', 'ss_link_grpc'], tlsLabel: 'URL TLS WS (Port 443)', httpLabel: 'URL HTTP WS (Port 80)'
  }
});

export const VALID_ACTIONS = Object.freeze(Object.keys(ACTION_SPECS));
const trialIpBuckets = new Map();

export function resetRateLimitStore() {
  trialIpBuckets.clear();
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  }
  if (typeof res.status === 'function' && typeof res.json === 'function' && !res.headersSent) {
    res.status(statusCode).json(payload);
    return;
  }
  res.statusCode = statusCode;
  res.end(body);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body.trim() ? JSON.parse(req.body) : {};
  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString('utf8').trim();
    return text ? JSON.parse(text) : {};
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      const err = new Error('Ukuran payload melebihi batas maksimum.');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function parseConfiguredServers() {
  const rawEnv = process.env.VPN_SERVERS_JSON;
  if (!rawEnv || !rawEnv.trim()) return { configured: false, servers: [], error: null };
  let parsed;
  try {
    parsed = JSON.parse(rawEnv);
  } catch {
    return { configured: false, servers: [], error: 'Format VPN_SERVERS_JSON tidak valid.' };
  }
  if (!Array.isArray(parsed)) return { configured: false, servers: [], error: 'VPN_SERVERS_JSON harus berupa array.' };

  const servers = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const domain = String(item.domain || '').trim();
    const auth = String(item.auth || '').trim();
    const port = item.port === undefined ? 5888 : Number(item.port);
    if (!id || !domain || !auth || !HOSTNAME_PATTERN.test(domain)) continue;
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    servers.push({
      id,
      name: String(item.name || id).trim(),
      region: String(item.region || 'Indonesia / Global').trim(),
      isp: String(item.isp || 'Cloud Node').trim(),
      domain,
      port,
      auth
    });
  }
  return { configured: servers.length > 0, servers, error: null };
}

function getClientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  const real = req.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkTrialRateLimit(clientIp) {
  const parsedMax = Number(process.env.TRIAL_RATE_LIMIT_MAX || DEFAULT_TRIAL_LIMIT);
  const limit = Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_TRIAL_LIMIT;
  const now = Date.now();
  const active = (trialIpBuckets.get(clientIp) || []).filter((ts) => ts > now - RATE_LIMIT_WINDOW_MS);
  if (active.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((active[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec, limit };
  }
  active.push(now);
  trialIpBuckets.set(clientIp, active);
  return { allowed: true, retryAfterSec: 0, limit };
}

// Fixed-length SHA-256 digests prevent PIN length leakage in timingSafeEqual.
function verifyAdminPin(candidatePin, expectedPin) {
  if (typeof candidatePin !== 'string' || !candidatePin) return false;
  const digestA = createHash('sha256').update(candidatePin, 'utf8').digest();
  const digestB = createHash('sha256').update(expectedPin, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

function validateAndNormalizeParams(body, spec) {
  const user = String(body.user ?? body.username ?? '').trim();
  if (!user || user.length > 32 || !USERNAME_PATTERN.test(user)) {
    return { error: 'Username wajib berisi huruf dan angka saja (maks 32 karakter).' };
  }
  const password = spec.needsPassword ? String(body.password ?? '').trim() : '';
  if (spec.needsPassword && (!password || password.length > 64 || /\s/.test(password))) {
    return { error: 'Password SSH wajib diisi tanpa spasi (maks 64 karakter).' };
  }
  if (spec.tier === 'trial') {
    const rawIp = Number(body.iplimit);
    const iplimit = Number.isFinite(rawIp) && rawIp >= 1 ? Math.min(Math.floor(rawIp), 2) : 2;
    const rawQuota = Number(body.quota);
    const quota = spec.needsQuota && Number.isFinite(rawQuota) && rawQuota > 0 ? Math.min(Math.floor(rawQuota), 5) : 5;
    return { error: null, params: { user, password, exp: 1, quota, iplimit } };
  }
  const exp = Number(body.exp);
  const iplimit = Number(body.iplimit);
  const quota = spec.needsQuota ? Number(body.quota ?? 0) : 0;
  if (!Number.isInteger(exp) || exp < 1 || exp > 365) return { error: 'Masa aktif wajib 1 sampai 365 hari.' };
  if (!Number.isInteger(iplimit) || iplimit < 1 || iplimit > 100) return { error: 'Batas IP wajib 1 sampai 100.' };
  if (spec.needsQuota && (!Number.isInteger(quota) || quota < 0 || quota > 100000)) {
    return { error: 'Kuota GB wajib angka bulat 0 (Unlimited) atau lebih.' };
  }
  return { error: null, params: { user, password, exp, quota, iplimit } };
}

function buildUpstreamUrl(server, action, spec, params) {
  const query = new URLSearchParams({ user: params.user });
  if (spec.needsPassword) query.set('password', params.password);
  query.set('exp', String(params.exp));
  if (spec.needsQuota) query.set('quota', String(params.quota));
  query.set('iplimit', String(params.iplimit));
  query.set('auth', server.auth);
  return `http://${server.domain}:${server.port}/${action}?${query.toString()}`;
}

function pickStr(obj, keys, fallback = '-') {
  for (const key of keys) {
    const val = obj?.[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
  }
  return fallback;
}

function formatQuota(rawQuota, requestedQuota, needsQuota) {
  if (!needsQuota) return 'Sesuai kebijakan SSH node';
  if (rawQuota !== undefined && rawQuota !== null && String(rawQuota).trim() !== '') {
    const txt = String(rawQuota).trim();
    if (txt === '0' || txt.toLowerCase() === 'unlimited') return 'Unlimited';
    return /^\d+$/.test(txt) ? `${txt} GB` : txt;
  }
  return requestedQuota === 0 ? 'Unlimited' : `${requestedQuota} GB`;
}

function mapSshFields(action, spec, base, params, raw) {
  const password = pickStr(raw, ['password', 'pass'], params.password);
  const httpCustomTls = `${base.domain}:443@${base.username}:${password}`;
  const httpCustomHttp = `${base.domain}:80@${base.username}:${password}`;
  const payloadWs = pickStr(
    raw,
    ['payload_ws', 'payload'],
    `GET / HTTP/1.1[crlf]Host: ${base.domain}[crlf]Connection: Upgrade[crlf]User-Agent: [ua][crlf]Upgrade: websocket[crlf][crlf]`
  );
  const payloadDualRay = `GET /cdn-cgi/trace HTTP/1.1[crlf]Host: bug.example.com[crlf][crlf]GET-RAY / HTTP/1.1[crlf]Host: ${base.domain}[crlf]Connection: Upgrade[crlf]User-Agent: [ua][crlf]Upgrade: websocket[crlf][crlf]`;

  return {
    action, tier: spec.tier, protocol: spec.protocol,
    account: { username: base.username, password, uuid: null, cipher: null, expired: base.expired, quota: base.quotaLabel, iplimit: base.ipLimitLabel },
    server: base.serverInfo,
    ports: {
      openssh: pickStr(raw, ['openssh', 'port_openssh'], '22, 500, 40000'),
      dropbear: pickStr(raw, ['dropbear', 'port_dropbear'], '143, 109'),
      ssl_tls: pickStr(raw, ['ssl_tls', 'stunnel', 'ws_tls', 'port_tls'], '443'),
      ws_http: pickStr(raw, ['ws_http', 'ws_nontls', 'squid', 'port_http'], '80, 8080, 8880'),
      udp_custom: pickStr(raw, ['udp_custom', 'udpgw', 'badvpn'], '1-65535 / 7100-7300')
    },
    rawLinks: { http_custom_tls: httpCustomTls, http_custom_http: httpCustomHttp, payload_ws: payloadWs, payload_dualray: payloadDualRay, save_txt: base.saveTxtUrl },
    links: [
      { key: 'http_custom_tls', label: 'HTTP Custom (TLS 443)', value: httpCustomTls },
      { key: 'http_custom_http', label: 'HTTP Custom (HTTP 80)', value: httpCustomHttp },
      { key: 'payload_ws', label: 'Payload WS Standar', value: payloadWs },
      { key: 'payload_dualray', label: 'Payload WS Dual-Ray CDN-CGI', value: payloadDualRay },
      { key: 'save_txt', label: 'Tautan Simpan .txt', value: base.saveTxtUrl }
    ]
  };
}

function mapXrayFields(action, spec, base, raw) {
  const cfg = XRAY_PROTO_CONFIG[spec.protocol];
  const uuid = pickStr(raw, cfg.secret, '-');
  const cipher = spec.protocol === 'shadowsocks' ? pickStr(raw, ['cipher', 'method'], cfg.cipher) : cfg.cipher;
  const pathWs = pickStr(raw, ['path', 'ws_path'], cfg.path);
  const serviceName = pickStr(raw, ['serviceName', 'service_name', 'grpc_service'], cfg.grpc);
  const urlTls = pickStr(raw, cfg.tls, '');
  const urlHttp = pickStr(raw, cfg.http, '');
  const urlGrpc = pickStr(raw, cfg.grpcKeys, '');
  const payloadWs = `GET ${pathWs} HTTP/1.1[crlf]Host: ${base.domain}[crlf]Connection: Upgrade[crlf]User-Agent: [ua][crlf]Upgrade: websocket[crlf][crlf]`;
  const [tlsKey, httpKey, grpcKey] = cfg.rawNames;

  return {
    action, tier: spec.tier, protocol: spec.protocol,
    account: { username: base.username, password: null, uuid, cipher, expired: base.expired, quota: base.quotaLabel, iplimit: base.ipLimitLabel },
    server: base.serverInfo,
    ports: {
      tls: pickStr(raw, ['port_tls', 'tls'], '443'),
      http: pickStr(raw, ['port_none_tls', 'nontls', 'http'], '80, 8080'),
      grpc: pickStr(raw, ['port_grpc', 'grpc'], '443'),
      path_ws: pathWs,
      service_grpc: serviceName
    },
    rawLinks: { [tlsKey]: urlTls, [httpKey]: urlHttp, [grpcKey]: urlGrpc, payload_ws: payloadWs, save_txt: base.saveTxtUrl },
    links: [
      urlTls ? { key: 'url_tls', label: cfg.tlsLabel, value: urlTls } : null,
      urlHttp ? { key: 'url_http', label: cfg.httpLabel, value: urlHttp } : null,
      urlGrpc ? { key: 'url_grpc', label: 'URL gRPC (Port 443)', value: urlGrpc } : null,
      { key: 'payload_ws', label: 'Payload WS', value: payloadWs },
      { key: 'save_txt', label: 'Tautan Simpan .txt', value: base.saveTxtUrl }
    ].filter(Boolean)
  };
}

function mapProtocolPayload(action, spec, server, params, raw) {
  const username = pickStr(raw, ['username', 'user'], params.user);
  const domain = pickStr(raw, ['domain', 'host'], server.domain);
  const ipRaw = pickStr(raw, ['iplimit', 'ip_limit'], String(params.iplimit));
  const base = {
    username, domain,
    expired: pickStr(raw, ['expired', 'exp_date', 'exp'], `${params.exp} Hari`),
    quotaLabel: formatQuota(raw?.quota, params.quota, spec.needsQuota),
    ipLimitLabel: /^\d+$/.test(ipRaw) ? `${ipRaw} IP` : ipRaw,
    saveTxtUrl: pickStr(raw, ['save_link', 'link_save'], `http://${domain}:81/${spec.protocol}-${username}.txt`),
    serverInfo: {
      id: server.id, name: server.name, domain,
      ip: pickStr(raw, ['ip', 'server_ip'], '-'),
      region: pickStr(raw, ['city', 'location', 'Location', 'region'], server.region),
      isp: pickStr(raw, ['isp', 'ISP'], server.isp),
      cloudfront: pickStr(raw, ['cloudfront', 'cf_domain'], '-'),
      ns_domain: pickStr(raw, ['ns_domain', 'nsdomain', 'slowdns'], '-'),
      pubkey: pickStr(raw, ['pubkey', 'public_key'], '-')
    }
  };
  return spec.protocol === 'ssh' ? mapSshFields(action, spec, base, params, raw) : mapXrayFields(action, spec, base, raw);
}

function buildPlainTextReport(mapped) {
  const lines = [
    'DOCTOR BARMODS | LEMBAR KREDENSIAL TUNNEL',
    '================================================',
    `Tipe Layanan : ${mapped.tier === 'premium' ? 'PREMIUM' : 'TRIAL PUBLIK'} (${mapped.protocol.toUpperCase()})`,
    `Node Server  : ${mapped.server.name} (${mapped.server.region})`,
    `ISP Node     : ${mapped.server.isp}`,
    `Domain Host  : ${mapped.server.domain}`,
    `IP Publik    : ${mapped.server.ip}`,
    `CloudFront   : ${mapped.server.cloudfront}`,
    `NS SlowDNS   : ${mapped.server.ns_domain}`,
    `Public Key   : ${mapped.server.pubkey}`,
    '------------------------------------------------',
    `Username     : ${mapped.account.username}`
  ];
  if (mapped.account.password) lines.push(`Password     : ${mapped.account.password}`);
  if (mapped.account.uuid) lines.push(`UUID / Key   : ${mapped.account.uuid}`);
  if (mapped.account.cipher) lines.push(`Enkripsi     : ${mapped.account.cipher}`);
  lines.push(`Masa Aktif   : ${mapped.account.expired}`, `Kuota Data   : ${mapped.account.quota}`, `Batas Login  : ${mapped.account.iplimit}`, '------------------------------------------------', 'SPESIFIKASI PORT & JALUR');
  for (const [k, v] of Object.entries(mapped.ports)) lines.push(`${k.padEnd(13, ' ')}: ${v}`);
  lines.push('------------------------------------------------', 'TAUTAN KONFIGURASI & PAYLOAD');
  for (const item of mapped.links) lines.push(`[${item.label}]`, item.value, '');
  lines.push('================================================', 'Diterbitkan melalui Doctor Barmods Console');
  return lines.join('\n');
}

function handleGetServers(res) {
  const config = parseConfiguredServers();
  if (config.error) return sendJson(res, 500, { status: 'error', configured: false, servers: [], message: config.error });
  const servers = config.servers.map(({ id, name, region, isp }) => ({ id, name, region, isp }));
  sendJson(res, 200, {
    status: 'success', configured: config.configured, servers, actions: VALID_ACTIONS,
    message: config.configured ? `${servers.length} node siap.` : 'VPN_SERVERS_JSON belum diatur.'
  });
}

async function fetchUpstreamAccount(upstreamUrl) {
  let response;
  try {
    response = await fetch(upstreamUrl, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { statusCode: 504, error: timedOut ? 'Koneksi node melewati batas 15 detik.' : 'Gagal menghubungi daemon node VPN.' };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { statusCode: 502, error: 'Daemon node VPN mengembalikan respons non-JSON.' };
  }
  const nested = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? (payload.data.data && typeof payload.data.data === 'object' ? payload.data.data : payload.data)
    : null;
  if (!response.ok || payload?.status === 'error' || payload?.success === false || !nested) {
    const msg = typeof payload?.message === 'string' && payload.message.trim()
      ? payload.message.replace(/auth=[^&\s]+/gi, 'auth=[REDACTED]').trim()
      : 'Node VPN menolak permintaan pembuatan akun.';
    return { statusCode: response.ok ? 400 : 502, error: msg };
  }
  return { statusCode: 200, data: nested };
}

async function handlePostProvision(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { status: 'error', message: err.statusCode === 413 ? err.message : 'JSON tidak valid.' });
  }
  const action = String(body?.action || '').trim().toLowerCase();
  const spec = ACTION_SPECS[action];
  if (!spec) return sendJson(res, 400, { status: 'error', message: `Action tidak valid. Pilih: ${VALID_ACTIONS.join(', ')}.` });

  const config = parseConfiguredServers();
  if (config.error) return sendJson(res, 500, { status: 'error', message: config.error });
  if (!config.configured) return sendJson(res, 503, { status: 'error', message: 'VPN_SERVERS_JSON belum dikonfigurasi.' });

  const server = config.servers.find((s) => s.id === String(body?.serverId || '').trim());
  if (!server) return sendJson(res, 400, { status: 'error', message: 'Node server tidak ditemukan.' });

  if (spec.tier === 'premium') {
    const expectedPin = String(process.env.ADMIN_PIN || '').trim();
    if (!expectedPin) return sendJson(res, 503, { status: 'error', message: 'ADMIN_PIN belum dikonfigurasi pada server.' });
    if (!verifyAdminPin(String(body?.adminPin ?? body?.pin ?? ''), expectedPin)) {
      return sendJson(res, 401, { status: 'error', message: 'PIN Admin tidak valid.' });
    }
  }

  const validation = validateAndNormalizeParams(body || {}, spec);
  if (validation.error) return sendJson(res, 400, { status: 'error', message: validation.error });

  if (spec.tier === 'trial') {
    const limitState = checkTrialRateLimit(getClientIp(req));
    if (!limitState.allowed) {
      return sendJson(res, 429, { status: 'error', message: `Batas Trial tercapai (${limitState.limit}/15 menit).` }, { 'Retry-After': String(limitState.retryAfterSec) });
    }
  }

  const upstream = await fetchUpstreamAccount(buildUpstreamUrl(server, action, spec, validation.params));
  if (upstream.error) return sendJson(res, upstream.statusCode, { status: 'error', message: upstream.error });

  const mapped = mapProtocolPayload(action, spec, server, validation.params, upstream.data);
  sendJson(res, 200, { status: 'success', message: `Akun ${spec.protocol.toUpperCase()} berhasil diterbitkan.`, ...mapped, reportText: buildPlainTextReport(mapped) });
}

export default async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return handleGetServers(res);
  if (method === 'POST') return handlePostProvision(req, res);
  sendJson(res, 405, { status: 'error', message: 'Gunakan metode GET atau POST.' }, { Allow: 'GET, POST' });
}
