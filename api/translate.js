export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on server' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const FIELD_GUIDE = `
Available fields in the MetroGIS 7-County Parcel dataset:
- PIN: Parcel ID (string)
- COUNTY_PIN: County-specific parcel ID
- CO_NAME: County name — must be one of: Anoka, Carver, Dakota, Hennepin, Ramsey, Scott, Washington (mixed case)
- CTU_NAME: City/township name (mixed case, e.g. 'Saint Paul', 'Minneapolis', 'Bloomington', 'Eagan', 'Saint Francis')
- ZIP: ZIP code (string)
- OWNER_NAME: Owner name (uppercase)
- OWN_ADD_L1: Owner address line 1
- HOMESTEAD: Homestead status — 'Yes' or 'No'
- ACRES_POLY: Parcel area in acres (numeric)
- ACRES_DEED: Deeded acres (numeric)
- EMV_LAND: Estimated market value of land only (numeric)
- EMV_BLDG: Estimated market value of building/improvements (numeric, 0 if vacant)
- EMV_TOTAL: Total estimated market value (numeric)
- TAX_YEAR: Tax year (numeric, e.g. 2026)
- MKT_YEAR: Market year (numeric)
- TAX_CAPAC: Tax capacity (numeric)
- TOTAL_TAX: Total tax (numeric)
- USECLASS1: Primary use class (string, e.g. '1a RESIDENTIAL SINGLE UNIT', '2a AGRICULTURAL', '3a COMMERCIAL', '4a INDUSTRIAL', 'EXEMPT', 'VACANT LAND')
- USECLASS2, USECLASS3, USECLASS4: Secondary use classes
- DWELL_TYPE: Dwelling type
- HOME_STYLE: Home style (e.g. 'Two Story', 'Rambler', 'Bi-level')
- FIN_SQ_FT: Finished square footage (numeric)
- YEAR_BUILT: Year built (numeric)
- NUM_UNITS: Number of units (numeric)
- SALE_DATE: Last sale date (epoch milliseconds)
- SALE_VALUE: Last sale value (numeric)
- GREEN_ACRE: Green acres status ('Yes'/'No')
- SCHOOL_DST: School district
- WSHD_DST: Watershed district

For building-to-total ratio: (EMV_BLDG * 1.0 / EMV_TOTAL)
For underutilized: EMV_TOTAL > 0 AND (EMV_BLDG * 1.0 / EMV_TOTAL) < 0.20
For vacant/low improvement: EMV_BLDG = 0 OR (EMV_TOTAL > 0 AND (EMV_BLDG * 1.0 / EMV_TOTAL) < 0.10)
String comparisons: use LIKE for partial matches, = for exact. CTU_NAME and CO_NAME are mixed case.
USECLASS1 uses LIKE for category matching: USECLASS1 LIKE '%COMMERCIAL%', USECLASS1 LIKE '%INDUSTRIAL%', USECLASS1 LIKE '%AGRICULTURAL%'
`;

  const systemPrompt = `You are a GIS data analyst. Given a natural language question about Twin Cities metro tax parcels, respond ONLY with valid JSON — no markdown, no explanation, no preamble, no code fences.

${FIELD_GUIDE}

Respond with exactly this JSON shape:
{
  "where": "<valid ArcGIS SQL WHERE clause>",
  "outFields": "PIN,CO_NAME,CTU_NAME,USECLASS1,EMV_LAND,EMV_BLDG,EMV_TOTAL,ACRES_POLY,OWNER_NAME,OWN_ADD_L1,ZIP,YEAR_BUILT,SALE_VALUE,SALE_DATE",
  "orderByFields": "<field ASC or DESC>",
  "explanation": "<one sentence describing what this query returns>"
}

Rules:
- WHERE must be valid ArcGIS SQL. Use 1=1 if no filter needed.
- Never use subqueries or unsupported functions.
- For ratios: EMV_TOTAL > 0 AND (EMV_BLDG * 1.0 / EMV_TOTAL) < 0.15
- For "underutilized" default to EMV_TOTAL > 0 AND (EMV_BLDG * 1.0 / EMV_TOTAL) < 0.20
- For commercial: USECLASS1 LIKE '%COMMERCIAL%'
- For industrial: USECLASS1 LIKE '%INDUSTRIAL%'
- For vacant: EMV_BLDG = 0 OR USECLASS1 LIKE '%VACANT%'
- CTU_NAME city matching: use LIKE for partial, e.g. CTU_NAME LIKE '%Saint Paul%'
- Default orderByFields: EMV_TOTAL DESC`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: query }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();
    const raw = data.content[0].text.trim().replace(/^```json|```$/g, '').trim();
    const parsed = JSON.parse(raw);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
