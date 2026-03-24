// Vercel Serverless Function — /api/submit
// 1. Klaviyo: feliratkoztatás a listára (helyes v3 formátum)
// 2. Klaviyo: custom property-k frissítése (külön hívás — Klaviyo limitáció)
// 3. Notion: mentés az adatbázisba

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const {
    email,
    nev          = '',
    epuletNeve,
    epuletCime,
    epuletTipusa = 'kulso',
    telefon      = '',
    megjegyzes   = ''
  } = req.body || {};

  if (!email || !epuletNeve || !epuletCime) {
    return res.status(400).json({ error: 'Missing required fields: email, epuletNeve, epuletCime' });
  }

  const tipusLabel = epuletTipusa === 'kulso' ? 'Külső homlokzat' : 'Belső tér';
  const KLAVIYO_KEY     = process.env.KLAVIYO_PRIVATE_KEY;
  const KLAVIYO_LIST_ID = process.env.KLAVIYO_LIST_ID;
  const NOTION_KEY      = process.env.NOTION_API_KEY;
  const NOTION_DB       = process.env.NOTION_DATABASE_ID;
  const integrationErrors = [];

  // ─────────────────────────────────────────────────────────────
  // 1. KLAVIYO — feliratkoztatás a listára (helyes v3 struktúra)
  //    NOTE: custom property-k NEM küldhetők ebben a hívásban
  //    (Klaviyo limitáció: separate call szükséges)
  // ─────────────────────────────────────────────────────────────
  try {
    const subscribeRes = await fetch(
      'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs',
      {
        method: 'POST',
        headers: {
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
          'Content-Type':  'application/json',
          'revision':      '2023-12-15'
        },
        body: JSON.stringify({
          data: {
            type: 'profile-subscription-bulk-create-job',
            attributes: {
              profiles: {
                data: [
                  {
                    type: 'profile',
                    attributes: {
                      email:      email,
                      first_name: nev,
                      subscriptions: {
                        email: {
                          marketing: {
                            consent: 'SUBSCRIBED'
                          }
                        }
                      }
                    }
                  }
                ]
              }
            },
            relationships: {
              list: {
                data: {
                  type: 'list',
                  id:   KLAVIYO_LIST_ID
                }
              }
            }
          }
        })
      }
    );

    if (!subscribeRes.ok) {
      const body = await subscribeRes.text();
      console.error('[Klaviyo subscribe] error:', subscribeRes.status, body);
      integrationErrors.push({ service: 'klaviyo-subscribe', status: subscribeRes.status, body });
    } else {
      console.log('[Klaviyo subscribe] success:', email);
    }
  } catch (err) {
    console.error('[Klaviyo subscribe] fetch failed:', err.message);
    integrationErrors.push({ service: 'klaviyo-subscribe', error: err.message });
  }

  // ─────────────────────────────────────────────────────────────
  // 2. KLAVIYO — custom property-k beállítása
  //    POST /api/profiles → 201 ha új, 409 ha már létezik
  //    409 esetén: kinyerjük a profile ID-t és PATCH-eljük
  // ─────────────────────────────────────────────────────────────
  try {
    const customProps = {
      epulet_neve:   epuletNeve,
      epulet_cime:   epuletCime,
      epulet_tipusa: tipusLabel,
      telefon:       telefon,
      megjegyzes:    megjegyzes
    };

    const createRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        'Content-Type':  'application/json',
        'revision':      '2023-12-15'
      },
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: {
            email:      email,
            first_name: nev,
            properties: customProps
          }
        }
      })
    });

    if (createRes.status === 201) {
      console.log('[Klaviyo props] profile created with properties:', email);

    } else if (createRes.status === 409) {
      // Profil már létezik — kinyerjük az ID-t és PATCH-eljük
      const errData = await createRes.json();
      const profileId = errData?.errors?.[0]?.meta?.duplicate_profile_id;

      if (profileId) {
        const patchRes = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
            'Content-Type':  'application/json',
            'revision':      '2023-12-15'
          },
          body: JSON.stringify({
            data: {
              type: 'profile',
              id:   profileId,
              attributes: {
                first_name: nev,
                properties: customProps
              }
            }
          })
        });

        if (!patchRes.ok) {
          const body = await patchRes.text();
          console.error('[Klaviyo props] PATCH error:', patchRes.status, body);
          integrationErrors.push({ service: 'klaviyo-props', status: patchRes.status });
        } else {
          console.log('[Klaviyo props] profile updated:', email, profileId);
        }
      } else {
        console.warn('[Klaviyo props] 409 but no duplicate_profile_id in response');
      }

    } else {
      const body = await createRes.text();
      console.error('[Klaviyo props] unexpected status:', createRes.status, body);
      integrationErrors.push({ service: 'klaviyo-props', status: createRes.status });
    }
  } catch (err) {
    console.error('[Klaviyo props] fetch failed:', err.message);
    integrationErrors.push({ service: 'klaviyo-props', error: err.message });
  }

  // ─────────────────────────────────────────────────────────────
  // 3. NOTION — mentés az adatbázisba
  // ─────────────────────────────────────────────────────────────
  try {
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${NOTION_KEY}`,
        'Content-Type':   'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DB },
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
      integrationErrors.push({ service: 'notion', status: notionRes.status, body });
    } else {
      console.log('[Notion] saved:', epuletNeve, email);
    }
  } catch (err) {
    console.error('[Notion] fetch failed:', err.message);
    integrationErrors.push({ service: 'notion', error: err.message });
  }

  // Mindig 200 — UX nem blokkolódik, hibák logban vannak
  return res.status(200).json({ ok: true, errors: integrationErrors });
}
