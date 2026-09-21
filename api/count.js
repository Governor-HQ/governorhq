const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  const funnel = (req.query && req.query.funnel) || 'whatsapp-community';

  const { count, error } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('funnel', funnel);

  if (error) {
    console.error('count lookup failed:', error);
    return res.status(200).json({ count: 0 });
  }

  return res.status(200).json({ count: count || 0 });
};
