const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { funnel, full_name, whatsapp_number, country, state, expectation, website } = req.body || {};

  // Honeypot: a real visitor never sees or fills this field.
  // If it's filled, quietly pretend success so bots don't learn to look elsewhere.
  if (website) {
    return res.status(200).json({ ok: true });
  }

  if (!full_name || !whatsapp_number) {
    return res.status(400).json({ error: 'Name and WhatsApp number are required.' });
  }

  const { error } = await supabase.from('leads').insert({
    funnel: funnel || 'whatsapp-community',
    full_name: String(full_name).slice(0, 200),
    whatsapp_number: String(whatsapp_number).slice(0, 50),
    country: country ? String(country).slice(0, 100) : null,
    state: state ? String(state).slice(0, 100) : null,
    expectation: expectation ? String(expectation).slice(0, 2000) : null
  });

  if (error) {
    console.error('register insert failed:', error);
    return res.status(500).json({ error: 'Something went wrong saving your details.' });
  }

  return res.status(200).json({ ok: true });
};
