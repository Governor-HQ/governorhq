const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Governor';
const WHATSAPP_NUMBER = '2348138281223'; // same number used by the on-page WhatsApp button

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildWhatsAppLink(fullName) {
  const text = `Hi Governor! I'd love to join GovernorHQ. My name is ${fullName}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function welcomeEmailHtml(fullName, whatsappLink) {
  const firstName = escapeHtml(String(fullName).trim().split(/\s+/)[0] || 'there');
  return `<div style="font-family: Georgia, 'Times New Roman', serif; background:#0c0c0e; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background:#17171a; border:1px solid #2a2a2d; border-radius: 8px; padding: 32px 28px; color:#ece7dc;">
    <p style="margin:0 0 6px; font-size: 13px; letter-spacing:0.04em; color:#c99a4a; text-transform:uppercase;">GovernorHQ</p>
    <h1 style="margin:0 0 18px; font-size: 24px; line-height:1.3; color:#ece7dc;">You're in, ${firstName}.</h1>
    <p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#c9c6bb;">
      Your spot in GovernorHQ is confirmed. One step left: say hi on WhatsApp so I can get you into the group.
    </p>
    <p style="margin:0 0 28px; font-size:15px; line-height:1.6; color:#c9c6bb;">
      Already messaged from the page? Ignore this. If not, here's your link:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 28px;">
      <tr><td style="border-radius:4px; background:#c99a4a;">
        <a href="${whatsappLink}" style="display:inline-block; padding:14px 26px; font-family: -apple-system, Segoe UI, Arial, sans-serif; font-weight:700; font-size:15px; color:#0c0c0e; text-decoration:none; border-radius:4px;">
          Message Me on WhatsApp &rarr;
        </a>
      </td></tr>
    </table>
    <p style="margin:0; font-size:13px; line-height:1.6; color:#8b8879;">— Governor</p>
  </div>
</div>`;
}

async function sendWelcomeEmail(toEmail, fullName) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    console.error('Brevo not configured: missing BREVO_API_KEY or BREVO_SENDER_EMAIL');
    return;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: toEmail, name: fullName }],
        subject: "You're in. Welcome to GovernorHQ.",
        htmlContent: welcomeEmailHtml(fullName, buildWhatsAppLink(fullName))
      })
    });
    if (!res.ok) console.error('Brevo send failed:', res.status, await res.text());
  } catch (err) {
    console.error('Brevo send threw:', err);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { funnel, full_name, whatsapp_number, email, country, state, expectation, website } = req.body || {};
  if (website) return res.status(200).json({ ok: true }); // honeypot, silently succeed for bots

  if (!full_name || !whatsapp_number) return res.status(400).json({ error: 'Name and WhatsApp number are required.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const { error } = await supabase.from('leads').insert({
    funnel: funnel || 'whatsapp-community',
    full_name: String(full_name).slice(0, 200),
    whatsapp_number: String(whatsapp_number).slice(0, 50),
    email: String(email).slice(0, 200),
    country: country ? String(country).slice(0, 100) : null,
    state: state ? String(state).slice(0, 100) : null,
    expectation: expectation ? String(expectation).slice(0, 2000) : null
  });

  if (error) {
    console.error('register insert failed:', error);
    return res.status(500).json({ error: 'Something went wrong saving your details.' });
  }

  // Send the welcome email after the row is safely saved. If this fails, the
  // person is still registered — we don't want an email hiccup to block them.
  await sendWelcomeEmail(email, full_name);

  return res.status(200).json({ ok: true });
};