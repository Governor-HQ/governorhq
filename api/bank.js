// Private message bank API. Only someone who knows BANK_PASSCODE can read or change anything.
// Drafts live in Supabase (tables bank_items, bank_marks, bank_attempts), never in this public repo.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const COOKIE = 'ghq_bank';
const SESSION_DAYS = 30;
const MAX_FAILS_PER_IP = 5;      // wrong passcodes allowed per IP per hour
const MAX_FAILS_ALL = 100;       // backstop across all IPs per hour
const WINDOW_MS = 60 * 60 * 1000;

function sha(s) {
  return crypto.createHash('sha256').update(s).digest();
}

// Changing BANK_PASSCODE changes this key, which signs everyone out.
function sessionKey() {
  return sha('ghq-bank|' + process.env.BANK_PASSCODE + '|' + process.env.SUPABASE_SERVICE_KEY);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', sessionKey()).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const expected = crypto.createHmac('sha256', sessionKey()).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return typeof p.exp === 'number' && p.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function readCookie(req, name) {
  const raw = (req.headers && req.headers.cookie) || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function passcodeMatches(given) {
  // Compare hashes so the comparison time does not depend on where the strings differ.
  return crypto.timingSafeEqual(sha(String(given)), sha(String(process.env.BANK_PASSCODE)));
}

function cookieHeader(value, maxAge) {
  return COOKIE + '=' + value + '; Max-Age=' + maxAge + '; Path=/api; HttpOnly; Secure; SameSite=Strict';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function recentFails(ip) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const mine = await supabase.from('bank_attempts').select('*', { count: 'exact', head: true }).eq('ip', ip).gte('at', since);
  const all = await supabase.from('bank_attempts').select('*', { count: 'exact', head: true }).gte('at', since);
  if (mine.error || all.error) throw new Error('attempt lookup failed');
  return { mine: mine.count || 0, all: all.count || 0 };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const pass = process.env.BANK_PASSCODE || '';
  if (pass.length < 12) {
    return res.status(503).json({ error: 'not_configured' });
  }

  const authed = verify(readCookie(req, COOKIE));

  if (req.method === 'GET') {
    if (!authed) return res.status(401).json({ error: 'locked' });
    const items = await supabase
      .from('bank_items')
      .select('id, section, pos, tag, title, name, hint, orig, body, img, added')
      .order('section', { ascending: true })
      .order('pos', { ascending: true });
    const marks = await supabase.from('bank_marks').select('key, at');
    if (items.error || marks.error) {
      console.error('bank read failed:', items.error || marks.error);
      return res.status(500).json({ error: 'read_failed' });
    }
    const m = {};
    (marks.data || []).forEach((r) => { m[r.key] = r.at; });
    return res.status(200).json({ items: items.data || [], marks: m });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const type = String((req.headers && req.headers['content-type']) || '');
  if (type.indexOf('application/json') < 0) return res.status(415).json({ error: 'json_only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad_body' });

  if (body.action === 'login') {
    const ip = clientIp(req);
    let fails;
    try { fails = await recentFails(ip); } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'try_again' });
    }
    if (fails.mine >= MAX_FAILS_PER_IP || fails.all >= MAX_FAILS_ALL) {
      return res.status(429).json({ error: 'locked_out' });
    }
    if (typeof body.passcode === 'string' && passcodeMatches(body.passcode)) {
      await supabase.from('bank_attempts').delete().eq('ip', ip);
      const token = sign({ exp: Date.now() + SESSION_DAYS * 86400000 });
      res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400));
      return res.status(200).json({ ok: true });
    }
    await supabase.from('bank_attempts').insert({ ip: ip });
    await supabase.from('bank_attempts').delete().lt('at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    await sleep(700);
    return res.status(401).json({ error: 'wrong', left: Math.max(0, MAX_FAILS_PER_IP - fails.mine - 1) });
  }

  if (body.action === 'logout') {
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    return res.status(200).json({ ok: true });
  }

  if (!authed) return res.status(401).json({ error: 'locked' });

  if (body.action === 'mark') {
    const key = body.key;
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,110}$/.test(key)) return res.status(400).json({ error: 'bad_key' });
    const result = body.on
      ? await supabase.from('bank_marks').upsert({ key: key, at: new Date().toISOString() })
      : await supabase.from('bank_marks').delete().eq('key', key);
    if (result.error) {
      console.error('bank mark failed:', result.error);
      return res.status(500).json({ error: 'write_failed' });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown_action' });
};
