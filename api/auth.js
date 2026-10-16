// Sign in, sign out and "who am I" for all private pages.
const s = require('./_lib/session');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!s.configured()) return res.status(503).json({ error: 'not_configured' });

  if (req.method === 'GET') {
    const session = s.getSession(req);
    if (!session) return res.status(401).json({ error: 'locked' });
    return res.status(200).json({ role: session.role, tools: s.toolsFor(session) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const type = String((req.headers && req.headers['content-type']) || '');
  if (type.indexOf('application/json') < 0) return res.status(415).json({ error: 'json_only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad_body' });

  if (body.action === 'logout') {
    res.setHeader('Set-Cookie', s.endSession());
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'login') {
    const ip = s.clientIp(req);
    let fails;
    try { fails = await s.recentFails(ip); } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'try_again' });
    }
    if (fails.mine >= s.MAX_FAILS_PER_IP || fails.all >= s.MAX_FAILS_ALL) {
      return res.status(429).json({ error: 'locked_out' });
    }
    if (typeof body.passcode === 'string' && s.passcodeMatches(body.passcode)) {
      await s.supabase.from('bank_attempts').delete().eq('ip', ip);
      res.setHeader('Set-Cookie', s.startSession('owner'));
      return res.status(200).json({ ok: true });
    }
    await s.supabase.from('bank_attempts').insert({ ip: ip });
    await s.supabase.from('bank_attempts').delete().lt('at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    await sleep(700);
    return res.status(401).json({ error: 'wrong', left: Math.max(0, s.MAX_FAILS_PER_IP - fails.mine - 1) });
  }

  return res.status(400).json({ error: 'unknown_action' });
};
