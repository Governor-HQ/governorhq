// Private LinkedIn career data. Needs a signed-in session with the "career" permission.
// Content lives in Supabase (tables career_items, career_marks), never in this public repo.
const s = require('./_lib/session');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!s.configured()) return res.status(503).json({ error: 'not_configured' });

  const session = s.getSession(req);
  if (!session) return res.status(401).json({ error: 'locked' });
  if (!s.can(session, 'career')) return res.status(403).json({ error: 'no_access' });

  if (req.method === 'GET') {
    const read = (cols) => s.supabase
      .from('career_items')
      .select(cols)
      .order('section', { ascending: true })
      .order('pos', { ascending: true });
    let items = await read('id, section, pos, tag, title, body, added, topic');
    // Before the topic column exists (career-topics.sql not run yet), read without it.
    if (items.error) items = await read('id, section, pos, tag, title, body, added');
    const marks = await s.supabase.from('career_marks').select('key, at');
    if (items.error || marks.error) {
      console.error('career read failed:', items.error || marks.error);
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

  if (body.action === 'mark') {
    const key = body.key;
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,60}$/.test(key)) return res.status(400).json({ error: 'bad_key' });
    const result = body.on
      ? await s.supabase.from('career_marks').upsert({ key: key, at: new Date().toISOString() })
      : await s.supabase.from('career_marks').delete().eq('key', key);
    if (result.error) {
      console.error('career mark failed:', result.error);
      return res.status(500).json({ error: 'write_failed' });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown_action' });
};
