// Vercel Serverless Function — /api/submit
// Klaviyo: public key client API (nincs auth probléma)
// Notion: private integration key

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const {
    email,
    nev          = '',
    epuletNeve   = '',
    epuletCime   = '',
    epuletTipusa = 'kulso',
    telefon      = '',
    megjegyzes   = ''
  } = req.body || {};

  if (!email || !epuletNeve || !epuletCime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const tipusLabel = epuletTipusa === 'kulso' ? 'Külső homlokzat' : 'Belső tér';
  const errors = [];

  // ── 1. KLAVIYO ──────────────────────────────────────────────────
  // Client API — public key az URL-ben, nincs Authorization header
  // Docs: https://developers.klaviyo.com/en/reference/create_client_subscription
  try {
    const kRes = await fetch(
      'https://a.klaviyo.com/client/subscriptions/?company_id=UW5JqT',
      {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'revision':     '2023-12-15'
        },
        body: JSON.stringify({
          data: {
            type: 'subscription',
            attributes: {
              custom_source: 'website-funnel',
              profile: {
                data: {
                  type: 'profile',
                  attributes: {
                    email:      email,
                    first_name: nev,
                    properties: {
                      epulet_neve:   epuletNeve,
                      epulet_cime:   epuletCime,
                      epulet_tipusa: tipusLabel,
                      telefon:       telefon,
                      megjegyzes:    megjegyzes
                    }
                  }
                }
              }
            },
            relationships: {
              list: {
                data: { type: 'list', id: 'Xy9PRV' }
              }
            }
          }
        })
      }
    );

    const kBody = await kRes.text();
    if (!kRes.ok) {
      console.error('[Klaviyo] error:', kRes.status, kBody);
      errors.push({ service: 'klaviyo', status: kRes.status, body: kBody });
    } else {
      console.log('[Klaviyo] subscribed:', email, '→ list Xy9PRV');
    }
  } catch (err) {
    console.error('[Klaviyo] fetch failed:', err.message);
    errors.push({ service: 'klaviyo', error: err.message });
  }

  // ── 2. NOTION ───────────────────────────────────────────────────
  try {
    const NOTION_KEY = (process.env.NOTION_API_KEY     || '').trim();
    const NOTION_DB  = (process.env.NOTION_DATABASE_ID || '').trim();

    console.log('[Notion] key present:', !!NOTION_KEY, '| db:', NOTION_DB);

    const nRes = await fetch('https://api.notion.com/v1/pages', {
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${NOTION_KEY}`,
        'Content-Type':   'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DB },
        properties: {
          'Épület neve':          { title:      [{ text: { content: epuletNeve } }] },
          'Épület típusa':        { select:     { name: tipusLabel } },
          'Épület címe':          { rich_text:  [{ text: { content: epuletCime } }] },
          'Email cím':            { email:      email },
          'Kapcsolattartó neve':  { rich_text:  [{ text: { content: nev } }] },
          'Telefonszám':          { phone_number: telefon || null },
          'Megjegyzés':           { rich_text:  [{ text: { content: megjegyzes } }] },
          'Státusz':              { select:     { name: 'Új' } }
        }
      })
    });

    const nBody = await nRes.text();
    if (!nRes.ok) {
      console.error('[Notion] error:', nRes.status, nBody);
      errors.push({ service: 'notion', status: nRes.status, body: nBody });
    } else {
      console.log('[Notion] saved:', epuletNeve, '|', email);
    }
  } catch (err) {
    console.error('[Notion] fetch failed:', err.message);
    errors.push({ service: 'notion', error: err.message });
  }

  return res.status(200).json({ ok: true, errors });
}
