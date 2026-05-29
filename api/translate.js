
  const WI_FIELD_GUIDE = `
Available fields in the Wisconsin Statewide Parcel dataset:
- PARCELID: Parcel ID (string)
- TAXPARCELID: Tax Parcel ID (string)
- STATEID: State ID (string)
- CONAME: County name (mixed case, e.g. 'Milwaukee', 'Dane', 'Waukesha', 'Brown', 'Racine')
- PLACENAME: City/municipality name (mixed case, e.g. 'Madison', 'Milwaukee', 'Green Bay')
- SITEADRESS: Full physical address (string)
- ZIPCODE: ZIP code (string)
- OWNERNME1: Primary owner name (string)
- OWNERNME2: Secondary owner name (string)
- PSTLADRESS: Full mailing address (string)
- PROPCLASS: Class of property (string) — values: '1' Residential, '2' Commercial, '3' Manufacturing, '4' Agricultural, '5' Undeveloped/Vacant, '5M' Agricultural Forest, '6' Forest, '7' Other
- AUXCLASS: Auxiliary class (string)
- LNDVALUE: Assessed value of land only (numeric)
- IMPVALUE: Assessed value of improvements/building (numeric)
- CNTASSDVALUE: Total assessed value = land + improvements (numeric)
- ESTFMKVALUE: Estimated fair market value (numeric)
- NETPRPTA: Net property tax (numeric)
- GRSPRPTA: Gross property tax (numeric)
- ASSDACRES: Assessed acres (numeric)
- GISACRES: GIS-calculated acres (numeric)
- DEEDACRES: Deeded acres (numeric)
- SCHOOLDIST: School district name (string)
- TAXROLLYEAR: Tax roll year (string, e.g. '2024')
- PARCELFIPS: County FIPS code (string)

For building-to-total ratio: (IMPVALUE * 1.0 / CNTASSDVALUE)
For underutilized: CNTASSDVALUE > 0 AND (IMPVALUE * 1.0 / CNTASSDVALUE) < 0.20
For vacant/low improvement: IMPVALUE = 0 OR PROPCLASS = '5'
For commercial: PROPCLASS = '2'
For industrial/manufacturing: PROPCLASS = '3'
For agricultural: PROPCLASS = '4'
For residential: PROPCLASS = '1'
County/city matching rules:
- CONAME is all uppercase county name, e.g. CONAME = 'MILWAUKEE', CONAME = 'BROWN', CONAME = 'DANE', CONAME = 'WAUKESHA'
- PLACENAME uses format 'CITY OF X', 'TOWN OF X', or 'VILLAGE OF X' in all caps — you will not know which prefix applies, so always match all three using OR
- When the user says a city/municipality name, generate: (PLACENAME = 'CITY OF X' OR PLACENAME = 'TOWN OF X' OR PLACENAME = 'VILLAGE OF X') where X is the uppercased name
- Example: user says "Green Bay" → (PLACENAME = 'CITY OF GREEN BAY' OR PLACENAME = 'TOWN OF GREEN BAY' OR PLACENAME = 'VILLAGE OF GREEN BAY')
- Example: user says "Madison" → (PLACENAME = 'CITY OF MADISON' OR PLACENAME = 'TOWN OF MADISON' OR PLACENAME = 'VILLAGE OF MADISON')
- NEVER use leading wildcards like LIKE '%GREEN BAY%' — ArcGIS blocks them on large datasets
- For county matching always use exact uppercase: CONAME = 'MILWAUKEE'
`;


async function translateWIQuery(query, key, model) {
  const systemPrompt = `You are a GIS data analyst. Given a natural language question about Wisconsin tax parcels, respond ONLY with valid JSON — no markdown, no explanation, no preamble, no code fences.

${WI_FIELD_GUIDE}

Respond with exactly this JSON shape:
{
  "where": "<valid ArcGIS SQL WHERE clause>",
  "outFields": "PARCELID,CONAME,PLACENAME,PROPCLASS,LNDVALUE,IMPVALUE,CNTASSDVALUE,ESTFMKVALUE,GISACRES,OWNERNME1,SITEADRESS,ZIPCODE,TAXROLLYEAR,NETPRPTA",
  "orderByFields": "<field ASC or DESC>",
  "explanation": "<one sentence describing what this query returns>"
}

Rules:
- WHERE must be valid ArcGIS SQL. Use 1=1 if no filter needed.
- Never use subqueries or unsupported functions.
- For ratios: CNTASSDVALUE > 0 AND (IMPVALUE * 1.0 / CNTASSDVALUE) < 0.15
- For underutilized: CNTASSDVALUE > 0 AND (IMPVALUE * 1.0 / CNTASSDVALUE) < 0.20
- PROPCLASS values are strings: '1','2','3','4','5' — always quote them
- Default orderByFields: CNTASSDVALUE DESC`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: query }]
    })
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error?.message || 'Anthropic API error'); }
  const data = await response.json();
  const raw = data.content[0].text.trim().replace(/^```json|```$/g, '').trim();
  return JSON.parse(raw);
}


async function getLatestModel(key) {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    });
    if (!resp.ok) return 'claude-sonnet-4-6';
    const data = await resp.json();
    // Prefer latest Sonnet, fall back to first available
    const models = data.data || [];
    const sonnet = models.find(m => m.id.includes('sonnet'));
    return sonnet ? sonnet.id : (models[0]?.id || 'claude-sonnet-4-6');
  } catch {
    return 'claude-sonnet-4-6';
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, apiKey, dataset } = req.body;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(401).json({ error: 'No API key provided. Please enter your Anthropic API key.' });

  // Route to Wisconsin translator if requested
  if (dataset === 'wi') {
    try {
      const model = await getLatestModel(key);
      const parsed = await translateWIQuery(query, key, model);
      return res.status(200).json(parsed);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const FIELD_GUIDE = `
Available fields in the MetroGIS 7-County Parcel dataset:
- PIN: Parcel ID (string)
- CO_NAME: County name — one of: Anoka, Carver, Dakota, Hennepin, Ramsey, Scott, Washington
- CTU_NAME: City/township name (mixed case, e.g. 'Saint Paul', 'Minneapolis', 'Bloomington', 'Eagan')
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
- TAX_CAPAC: Tax capacity (numeric)
- TOTAL_TAX: Total tax (numeric)
- USECLASS1: Primary use class (e.g. '1a RESIDENTIAL SINGLE UNIT', '2a AGRICULTURAL', '3a COMMERCIAL', '4a INDUSTRIAL', 'EXEMPT')
- USECLASS2, USECLASS3, USECLASS4: Secondary use classes
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
USECLASS1 matching: use LIKE, e.g. USECLASS1 LIKE '%COMMERCIAL%', USECLASS1 LIKE '%INDUSTRIAL%'
CTU_NAME matching: use LIKE, e.g. CTU_NAME LIKE '%Saint Paul%'
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
- Default orderByFields: EMV_TOTAL DESC`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: await getLatestModel(key),
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
