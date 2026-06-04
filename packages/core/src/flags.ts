/**
 * Emoji flags from country identifiers — zero image assets, no copyright,
 * render natively almost everywhere.
 *
 * Region codes are ISO 3166-1 alpha-2 (e.g. "MX"), with three special
 * subdivision codes for the home nations ("GB-SCT", "GB-ENG", "GB-WLS")
 * which use emoji tag sequences rather than regional-indicator pairs.
 */

const REGIONAL_INDICATOR_A = 0x1f1e6;
const TAG_BASE = 0xe0000;
const TAG_CANCEL = 0xe007f;
const BLACK_FLAG = 0x1f3f4;
const NEUTRAL = '🏳️';

/** Normalize a free-text nation name/code for map lookups. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z]/g, ''); // strip spaces/punctuation
}

/** England/Scotland/Wales: 🏴 + tag letters + cancel tag. */
function subdivisionFlag(lettersOnly: string): string {
  const tags = [...lettersOnly].map((c) => TAG_BASE + c.charCodeAt(0));
  return String.fromCodePoint(BLACK_FLAG, ...tags, TAG_CANCEL);
}

/**
 * Convert a region code to an emoji flag.
 * - "MX" -> 🇲🇽
 * - "GB-SCT" -> 🏴 (Scotland subdivision flag)
 * Returns the neutral flag for anything unrecognized.
 */
export function flagEmoji(region: string): string {
  const r = region.trim();
  if (r.includes('-')) {
    const letters = r.toLowerCase().replace(/-/g, '');
    return subdivisionFlag(letters);
  }
  const cc = r.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return NEUTRAL;
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (cc.charCodeAt(0) - 65),
    REGIONAL_INDICATOR_A + (cc.charCodeAt(1) - 65),
  );
}

// Readable nation -> region-code table. Broad enough to cover the full 48-team
// field plus likely qualifiers; extend freely.
const NATIONS: ReadonlyArray<readonly [string, string]> = [
  ['Mexico', 'MX'], ['South Africa', 'ZA'], ['South Korea', 'KR'],
  ['Czechia', 'CZ'], ['Canada', 'CA'], ['Bosnia-Herzegovina', 'BA'],
  ['United States', 'US'], ['Paraguay', 'PY'], ['Qatar', 'QA'],
  ['Switzerland', 'CH'], ['Brazil', 'BR'], ['Morocco', 'MA'],
  ['Haiti', 'HT'], ['Scotland', 'GB-SCT'], ['Australia', 'AU'],
  ['Türkiye', 'TR'], ['Germany', 'DE'], ['Curacao', 'CW'],
  ['Netherlands', 'NL'], ['Japan', 'JP'], ['Ivory Coast', 'CI'],
  ['Ecuador', 'EC'], ['Sweden', 'SE'], ['Tunisia', 'TN'],
  ['Argentina', 'AR'], ['France', 'FR'], ['Spain', 'ES'],
  ['Portugal', 'PT'], ['England', 'GB-ENG'], ['Wales', 'GB-WLS'],
  ['Belgium', 'BE'], ['Croatia', 'HR'], ['Uruguay', 'UY'],
  ['Colombia', 'CO'], ['Senegal', 'SN'], ['Iran', 'IR'],
  ['Saudi Arabia', 'SA'], ['Egypt', 'EG'], ['Nigeria', 'NG'],
  ['Ghana', 'GH'], ['Cameroon', 'CM'], ['Algeria', 'DZ'],
  ['Norway', 'NO'], ['Denmark', 'DK'], ['Austria', 'AT'],
  ['Poland', 'PL'], ['Italy', 'IT'], ['Serbia', 'RS'],
  ['Panama', 'PA'], ['Costa Rica', 'CR'], ['Jordan', 'JO'],
  ['Uzbekistan', 'UZ'], ['New Zealand', 'NZ'], ['Cape Verde', 'CV'],
  ['Jamaica', 'JM'], ['Peru', 'PE'], ['Chile', 'CL'],
  ['Honduras', 'HN'], ['DR Congo', 'CD'], ['Mali', 'ML'],
  ['Venezuela', 'VE'], ['Greece', 'GR'], ['Hungary', 'HU'],
  ['Slovenia', 'SI'], ['Slovakia', 'SK'], ['Romania', 'RO'],
  ['Ukraine', 'UA'], ['Angola', 'AO'], ['Benin', 'BJ'],
  ['Gabon', 'GA'], ['Bolivia', 'BO'], ['Guinea', 'GN'],
  ['Burkina Faso', 'BF'], ['Zambia', 'ZM'], ['Iraq', 'IQ'],
  ['United Arab Emirates', 'AE'], ['Oman', 'OM'], ['Bahrain', 'BH'],
  ['China', 'CN'], ['Indonesia', 'ID'], ['Thailand', 'TH'],
  ['Vietnam', 'VN'], ['India', 'IN'], ['Russia', 'RU'],
  ['Finland', 'FI'], ['Ireland', 'IE'], ['Northern Ireland', 'GB-NIR'],
  ['Iceland', 'IS'], ['Albania', 'AL'], ['Georgia', 'GE'],
  ['North Macedonia', 'MK'], ['Montenegro', 'ME'], ['Kosovo', 'XK'],
];

// Aliases / alternate spellings -> region code.
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['Turkey', 'TR'], ['Korea Republic', 'KR'], ['Republic of Korea', 'KR'],
  ['Korea DPR', 'KP'], ['North Korea', 'KP'], ['Czech Republic', 'CZ'],
  ["Cote d'Ivoire", 'CI'], ['Cote dIvoire', 'CI'], ['Côte d’Ivoire', 'CI'],
  ['Bosnia and Herzegovina', 'BA'], ['Bosnia', 'BA'],
  ['USA', 'US'], ['United States of America', 'US'], ['US', 'US'],
  ['Cabo Verde', 'CV'], ['Congo DR', 'CD'], ['Democratic Republic of the Congo', 'CD'],
  ['IR Iran', 'IR'], ['Curaçao', 'CW'], ['Holland', 'NL'],
  ['Republic of Ireland', 'IE'], ['UAE', 'AE'],
  // Names where Intl's English label differs from the common short form.
  ['Hong Kong', 'HK'], ['Myanmar', 'MM'], ['Palestine', 'PS'],
  ['Burma', 'MM'], ['Cape Verde', 'CV'],
];

const BY_NATION: Record<string, string> = Object.fromEntries(
  [...NATIONS, ...ALIASES].map(([name, code]) => [norm(name), code]),
);

// Best-effort FIFA/IOC 3-letter codes -> region code (secondary lookup path).
const BY_CODE: Record<string, string> = {
  MEX: 'MX', RSA: 'ZA', KOR: 'KR', CZE: 'CZ', CAN: 'CA', BIH: 'BA',
  USA: 'US', PAR: 'PY', QAT: 'QA', SUI: 'CH', BRA: 'BR', MAR: 'MA',
  HAI: 'HT', SCO: 'GB-SCT', AUS: 'AU', TUR: 'TR', GER: 'DE', CUW: 'CW',
  NED: 'NL', JPN: 'JP', CIV: 'CI', ECU: 'EC', SWE: 'SE', TUN: 'TN',
  ARG: 'AR', FRA: 'FR', ESP: 'ES', POR: 'PT', ENG: 'GB-ENG', WAL: 'GB-WLS',
  BEL: 'BE', CRO: 'HR', URU: 'UY', COL: 'CO', SEN: 'SN', IRN: 'IR',
  KSA: 'SA', EGY: 'EG', NGA: 'NG', GHA: 'GH', CMR: 'CM', ALG: 'DZ',
  NOR: 'NO', DEN: 'DK', AUT: 'AT', POL: 'PL', ITA: 'IT', SRB: 'RS',
  PAN: 'PA', CRC: 'CR', JOR: 'JO', UZB: 'UZ', NZL: 'NZ', CPV: 'CV',
  JAM: 'JM', PER: 'PE', CHI: 'CL', HON: 'HN', COD: 'CD', MLI: 'ML',
};

/**
 * Resolve a flag emoji from a nation name or code.
 * Tries the name table first (ESPN reliably provides display names),
 * then the 3-letter code table, then a programmatic Intl reverse-lookup.
 * Falls back to the neutral flag.
 */
export function nationToFlag(nameOrCode: string | undefined | null): string {
  const region = nationToRegion(nameOrCode);
  return region ? flagEmoji(region) : NEUTRAL;
}

/**
 * Lazily-built map of normalized English country name -> ISO alpha-2 region,
 * derived from Intl.DisplayNames across all assigned 2-letter codes. This
 * covers virtually every nation (incl. ones outside the World Cup field) with
 * no hand-maintained table. Built once on first use.
 */
let INTL_BY_NAME: Record<string, string> | undefined;
function intlNameMap(): Record<string, string> {
  if (INTL_BY_NAME) return INTL_BY_NAME;
  const map: Record<string, string> = {};
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        let name: string | undefined;
        try {
          name = dn.of(code);
        } catch {
          name = undefined;
        }
        // Intl returns the code itself for unassigned regions — skip those.
        if (name && name !== code) {
          const key = norm(name);
          if (!(key in map)) map[key] = code;
        }
      }
    }
  } catch {
    // Intl.DisplayNames unavailable — leave the map empty.
  }
  INTL_BY_NAME = map;
  return map;
}

/**
 * Resolve a region code (alpha-2 / subdivision) from a nation name or code.
 * Order: curated name table → 3-letter code table → Intl reverse-lookup.
 */
export function nationToRegion(nameOrCode: string | undefined | null): string | undefined {
  if (!nameOrCode) return undefined;
  const byName = BY_NATION[norm(nameOrCode)];
  if (byName) return byName;
  const byCode = BY_CODE[nameOrCode.trim().toUpperCase()];
  if (byCode) return byCode;
  return intlNameMap()[norm(nameOrCode)];
}
