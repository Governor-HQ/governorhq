// Shared sign-in for every private page (Backstage, bank, and tools added later).
// Files whose names start with an underscore are not public routes on Vercel.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const COOKIE = 'ghq_session';
const SESSION_DAYS = 30;
const MAX_FAILS_PER_IP = 5;      // wrong passcodes allowed per IP per hour
const MAX_FAILS_ALL = 100;       // backstop across all IPs per hour
const WINDOW_MS = 60 * 60 * 1000;

// What each role may open. Today only the owner exists. When team accounts arrive,
// add roles here (for example editor: ['bank']) and put the role in the session.
const ROLES = {
  owner: ['*']
};

// Every private tool. `needs` is the permission a person must hold to see it.
const TOOLS = [
  { id: 'bank', name: 'Message bank', blurb: 'Your drafts and posts, ready to copy.', href: '/bank', needs: 'bank' },
  { id: 'studio', name: 'Content studio', blurb: 'Carousels, videos and post images.', href: null, planned: true, needs: 'studio' }
];

function sha(s) {
  return crypto.createHash('sha256').update(s).digest();
}

// Changing BANK_PASSCODE changes this key, which signs everyone out.
function sessionKey() {
  return sha('ghq-session|' + process.env.BANK_PASSCODE + '|' + process.env.SUPABASE_SERVICE_KEY);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', sessionKey()).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = crypto.createHmac('sha256', sessionKey()).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (typeof p.exp !== 'number' || p.exp <= Date.now()) return null;
    if (!ROLES[p.role]) return null;
    return { role: p.role, exp: p.exp };
  } catch (e) {
    return null;
  }
}

function readCookie(req, name) {
  const raw = (req.headers && req.headers.cookie) || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

function getSession(req) {
  return verify(readCookie(req, COOKIE));
}

function can(session, perm) {
  if (!session) return false;
  const list = ROLES[session.role] || [];
  return list.indexOf('*') >= 0 || list.indexOf(perm) >= 0;
}

function toolsFor(session) {
  return TOOLS.filter((t) => can(session, t.needs)).map((t) => ({
    id: t.id, name: t.name, blurb: t.blurb, href: t.href, planned: !!t.planned
  }));
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
  return COOKIE + '=' + value + '; Max-Age=' + maxAge + '; Path=/; HttpOnly; Secure; SameSite=Strict';
}

function startSession(role) {
  const token = sign({ role: role, exp: Date.now() + SESSION_DAYS * 86400000 });
  return cookieHeader(token, SESSION_DAYS * 86400);
}

function endSession() {
  return cookieHeader('', 0);
}

function configured() {
  return (process.env.BANK_PASSCODE || '').length >= 12;
}

async function recentFails(ip) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const mine = await supabase.from('bank_attempts').select('*', { count: 'exact', head: true }).eq('ip', ip).gte('at', since);
  const all = await supabase.from('bank_attempts').select('*', { count: 'exact', head: true }).gte('at', since);
  if (mine.error || all.error) throw new Error('attempt lookup failed');
  return { mine: mine.count || 0, all: all.count || 0 };
}

module.exports = {
  supabase, ROLES, MAX_FAILS_PER_IP, MAX_FAILS_ALL,
  getSession, can, toolsFor, clientIp, passcodeMatches, startSession, endSession, configured, recentFails
};
