// Vercel Serverless Function — /api/submit
// Fogadja a funnel form adatait, elküldi Klaviyo-nak és Notion-nak.

export default async function handler(req, res) {
  // CORS headers (ha szükséges file:// teszteléshez)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    email,
    nev          = '',
    epuletNeve,
    epuletCime,
    epuletTipusa = 'kulso',
    telefon      = '',
    megjegyzes   = ''
  } = req.body || {};

  // Alapvető validáció
  if (!email || !epuletNeve || !epuletCime) {
    return res.status(400).json({ error: 'Missing required fields: email, epuletNeve, epuletCime' });
  }

  const tipusLabel = epuletTipusa === 'kulso' ? 'Külső homlokzat' : 'Belső tér';
  const integrationErrors = [];

  // ──────────────────────────────────────────────────
  // 1. KLAVIYO — feliratkoztatás a listára
  // ──────────────────────────────────────────────────
  try {
    const klaviyoRes = await fetch(
      'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs',
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
          'revision':      '2023-12-15'
        },
        body: JSON.stringify({
          data: {
            type: 'profile-subscription-bulk-create-job',
            attributes: {
              list_id: process.env.KLAVIYO_LIST_ID,
              subscriptions: [
                {
                  channels: { email: ['MARKETING'] },
                  email: email,
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
                }
              ]
            }
          }
        })
      }
    );

    if (!klaviyoRes.ok) {
      const body = await klaviyoRes.text();
      console.error('[Klaviyo] error:', klaviyoRes.status, body);
      integrationErrors.push({ service: 'klaviyo', status: klaviyoRes.status });
    } else {
      console.log('[Klaviyo] subscribed:', email);
    }
  } catch (err) {
    console.error('[Klaviyo] fetch failed:', err.message);
    integrationErrors.push({ service: 'klaviyo', error: err.message });
  }

  // ──────────────────────────────────────────────────
  // 2. NOTION — mentés az adatbázisba
  // ──────────────────────────────────────────────────
  try {
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${process.env.NOTION_API_KEY}`,
        'Content-Type':   'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Épület neve': {
            title: [{ text: { content: epuletNeve } }]
          },
          'Épület típusa': {
            select: { name: tipusLabel }
          },
          'Épület címe': {
            rich_text: [{ text: { content: epuletCime } }]
          },
          'Email cím': {
            email: email
          },
          'Kapcsolattartó neve': {
            rich_text: [{ text: { content: nev } }]
          },
          'Telefonszám': {
            phone_number: telefon || null
          },
          'Megjegyzés': {
            rich_text: [{ text: { content: megjegyzes } }]
          },
          'Státusz': {
            select: { name: 'Új' }
          }
        }
      })
    });

    if (!notionRes.ok) {
      const body = await notionRes.text();
      console.error('[Notion] error:', notionRes.status, body);
      integrationErrors.push({ service: 'notion', status: notionRes.status });
    } else {
      console.log('[Notion] saved:', epuletNeve, email);
    }
  } catch (err) {
    console.error('[Notion] fetch failed:', err.message);
    integrationErrors.push({ service: 'notion', error: err.message });
  }

  // ──────────────────────────────────────────────────
  // Válasz — mindig 200, hogy a UX ne blokkolódjon
  // integrationErrors tömb logolásra / debugra
  // ──────────────────────────────────────────────────
  return res.status(200).json({
    ok:     true,
    errors: integrationErrors
  });
}
