/**
 * Emoji flags from country identifiers — zero image assets, no copyright,
 * render natively almost everywhere.
 *
 * Region codes are ISO 3166-1 alpha-2 (e.g. "MX"), with three special
 * subdivision codes for the home nations ("GB-SCT", "GB-ENG", "GB-WLS")
 * which use emoji tag sequences rather than regional-indicator pairs.
 *
 * Only a flag Unicode RECOMMENDS for general interchange (an RGI flag
 * sequence) is ever emitted: any other sequence is drawn as a plain black flag
 * (a tag sequence such as Northern Ireland's `gbnir`) or as two boxed letters
 * (a withdrawn or reserved code such as `RH`, `ZZ`). A nation lookup has three
 * answers, kept apart:
 *   - a recommended flag: a nation that has one;
 *   - `undefined`: a NATION whose flag Unicode does not recommend (Northern
 *     Ireland). It carries no flag and is rendered by its name, like a club;
 *     it is resolved, not a placeholder;
 *   - the neutral 🏳️: no nation at all (a bundle placeholder, "Round of 32 1
 *     Winner").
 */

const REGIONAL_INDICATOR_A = 0x1f1e6;
const TAG_BASE = 0xe0000;
const TAG_CANCEL = 0xe007f;
const BLACK_FLAG = 0x1f3f4;
const NEUTRAL = '🏳️';

/**
 * Unicode's own definition of a flag it recommends: a regional-indicator pair
 * it lists, or one of the tag sequences it lists (England, Scotland, Wales).
 */
// The constructor, not a literal: the compiler targets ES2022 and refuses a `v` literal (TS1501); the runtime (Node >= 22) has the flag.
// biome-ignore lint/complexity/useRegexLiterals: a `v` literal does not compile under the ES2022 target.
const RECOMMENDED = new RegExp('^(?:\\p{RGI_Emoji_Flag_Sequence}|\\p{RGI_Emoji_Tag_Sequence})$', 'v');

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

/** The sequence a region code spells, recommended or not (`undefined` when it spells none). */
function candidateFlag(region: string): string | undefined {
  const r = region.trim();
  if (r.includes('-')) {
    const letters = r.toLowerCase().replace(/-/g, '');
    return subdivisionFlag(letters);
  }
  const cc = r.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return undefined;
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (cc.charCodeAt(0) - 65),
    REGIONAL_INDICATOR_A + (cc.charCodeAt(1) - 65),
  );
}

/**
 * Convert a region code to an emoji flag.
 * - "MX" -> 🇲🇽
 * - "GB-SCT" -> 🏴 (Scotland subdivision flag)
 * Returns the neutral flag for anything that is not a flag Unicode recommends:
 * an unrecognized string, a code it does not list ("ZZ", the withdrawn "RH"),
 * or a subdivision it does not recommend ("GB-NIR"). This is the single exit,
 * so no table row can make it emit any other sequence.
 */
export function flagEmoji(region: string): string {
  const flag = candidateFlag(region);
  return flag !== undefined && RECOMMENDED.test(flag) ? flag : NEUTRAL;
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
  ['Finland', 'FI'], ['Ireland', 'IE'],
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
  // Concacaf nations as the provider spells them (measured in the recorded
  // Gold Cup and Nations League feeds), and their usual variants. Written rows,
  // not a wider normalization: `norm()` drops punctuation (so "St." and "St"
  // are one row, but "&" loses the "and" and needs a row of its own), Intl's
  // English names spell "&" and "St.", and rewriting "and" or "St." for every
  // name would be a grammar change nobody measured. Bonaire is "Caribbean
  // Netherlands" in Intl.
  ['Trinidad and Tobago', 'TT'], ['Trinidad & Tobago', 'TT'],
  ['St. Kitts and Nevis', 'KN'], ['Saint Kitts and Nevis', 'KN'], ['St. Kitts & Nevis', 'KN'],
  ['Bonaire', 'BQ'],
  ['St. Vincent and the Grenadines', 'VC'], ['Saint Vincent and the Grenadines', 'VC'],
  ['St. Vincent & the Grenadines', 'VC'],
  ['Turks and Caicos Islands', 'TC'], ['Turks & Caicos Islands', 'TC'],
  ['Antigua and Barbuda', 'AG'], ['Antigua & Barbuda', 'AG'],
];

/**
 * NULL-PROTOTYPE, and so are the two tables below.
 *
 * A plain object inherits from Object.prototype, so a bare index walks the
 * prototype chain on a miss. `norm()` strips everything outside [a-z], and
 * `norm('Constructor')` is exactly `'constructor'` — a real key on that
 * prototype whose value is the Object FUNCTION. A team named "Constructor"
 * therefore resolved to a function, `flagEmoji` called `.trim()` on it, and the
 * TypeError escaped the trust boundary: one poisoned record took down the whole
 * batch, on a boundary whose stated property is that it is total.
 */
const BY_NATION: Record<string, string> = Object.assign(
  Object.create(null),
  Object.fromEntries([...NATIONS, ...ALIASES].map(([name, code]) => [norm(name), code])),
);

// Best-effort FIFA/IOC 3-letter codes -> region code (secondary lookup path).
const BY_CODE: Record<string, string> = Object.assign(Object.create(null), {
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
});

/**
 * Nations whose flag Unicode does not recommend, by normalized name and by
 * 3-letter code. Northern Ireland's would be the subdivision tag sequence
 * `gbnir`, which is not RGI (Unicode recommends only England, Scotland and
 * Wales among subdivisions): every platform draws it as a plain black flag, a
 * placeholder's shape. Such a nation carries no flag at all and is rendered by
 * its name, like a club.
 */
const FLAGLESS_NAMES: ReadonlySet<string> = new Set(['Northern Ireland'].map(norm));
const FLAGLESS_CODES: ReadonlySet<string> = new Set(['NIR']);

/**
 * Resolve a flag emoji from a nation name or code.
 * Tries the name table first (ESPN reliably provides display names),
 * then the 3-letter code table, then a programmatic Intl reverse-lookup.
 * Three answers:
 *   - the region's flag, when it is one Unicode recommends;
 *   - `undefined` for a NATION whose flag Unicode does not recommend (the
 *     written flagless list, or a region found whose flag is not recommended):
 *     no flag, rendered by its name;
 *   - the neutral 🏳️ when no region is found: no nation at all.
 */
export function nationToFlag(nameOrCode: string | undefined | null): string | undefined {
  if (nameOrCode && (FLAGLESS_NAMES.has(norm(nameOrCode)) || FLAGLESS_CODES.has(nameOrCode.trim().toUpperCase()))) {
    return undefined;
  }
  const region = nationToRegion(nameOrCode);
  if (!region) return NEUTRAL;
  const flag = flagEmoji(region);
  return flag === NEUTRAL ? undefined : flag;
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
  const map: Record<string, string> = Object.create(null);
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
        // Skip too a code with no recommended flag: a withdrawn code (RH, YD,
        // NH, BU) would otherwise claim a name before its current one (A..Z
        // order), and a non-nation (EZ, ZZ, QO, XA, XB) is no region at all.
        if (name && name !== code && flagEmoji(code) !== NEUTRAL) {
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
 * It names the region of a FLAG: a nation whose flag Unicode does not
 * recommend (Northern Ireland) has none here, `undefined`, like no nation.
 */
export function nationToRegion(nameOrCode: string | undefined | null): string | undefined {
  if (!nameOrCode) return undefined;
  // Defence in depth behind the null-prototype tables: a region is a STRING,
  // and anything else a lookup produces is not one. Cheap, and it keeps a
  // future table built the ordinary way from becoming a crash again.
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return (
    str(BY_NATION[norm(nameOrCode)]) ??
    str(BY_CODE[nameOrCode.trim().toUpperCase()]) ??
    str(intlNameMap()[norm(nameOrCode)])
  );
}
