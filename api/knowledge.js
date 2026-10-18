// Private Knowledge bank data (read only). Needs a signed-in session with the "knowledge" permission.
// Content lives in Supabase (table knowledge_items), never in this public repo. Raw transcripts are never stored there.
const s = require('./_lib/session');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!s.configured()) return res.status(503).json({ error: 'not_configured' });

  const session = s.getSession(req);
  if (!session) return res.status(401).json({ error: 'locked' });
  if (!s.can(session, 'knowledge')) return res.status(403).json({ error: 'no_access' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });

  const items = await s.supabase
    .from('knowledge_items')
    .select('id, section, pos, tag, title, body, topic, source, status, added')
    .order('section', { ascending: true })
    .order('pos', { ascending: true });
  if (items.error) {
    console.error('knowledge read failed:', items.error);
    return res.status(500).json({ error: 'read_failed' });
  }
  return res.status(200).json({ items: items.data || [] });
};
