/**
 * The approved flag colors of the stadium's scarf, by the provider's team id: each national team's flag as two or
 * three plain colors in the flag's order (a vertical flag left to right, a horizontal one top to bottom, any other:
 * the field first, then its most prominent colors). The plugin's `FLAG_COLORS` must equal this table, row for row:
 * a row changed there and not here is a red test, and the other way round.
 */
export const FLAGS_APPROVED: Readonly<Record<string, readonly string[]>> = {
  'espn:624': ['006233', 'ffffff', 'd21034'], // Algeria
  'espn:202': ['74acdf', 'ffffff', '74acdf'], // Argentina
  'espn:628': ['012169', 'ffffff', 'c8102e'], // Australia
  'espn:474': ['ed2939', 'ffffff', 'ed2939'], // Austria
  'espn:459': ['000000', 'fdda24', 'ef3340'], // Belgium
  'espn:452': ['002395', 'fecb00', 'ffffff'], // Bosnia-Herzegovina
  'espn:205': ['009c3b', 'ffdf00', '002776'], // Brazil
  'espn:206': ['ff0000', 'ffffff', 'ff0000'], // Canada
  'espn:2597': ['003893', 'ffffff', 'cf2027'], // Cape Verde
  'espn:208': ['fcd116', '003893', 'ce1126'], // Colombia
  'espn:2850': ['007fff', 'f7d618', 'ce1021'], // Congo DR
  'espn:477': ['ff0000', 'ffffff', '171796'], // Croatia
  'espn:11678': ['002b7f', 'f9e814'], // Curaçao
  'espn:450': ['ffffff', 'd7141a', '11457e'], // Czechia
  'espn:209': ['ffdd00', '034ea2', 'ed1c24'], // Ecuador
  'espn:2620': ['ce1126', 'ffffff', '000000'], // Egypt
  'espn:448': ['ffffff', 'ce1124', 'ffffff'], // England
  'espn:478': ['0055a4', 'ffffff', 'ef4135'], // France
  'espn:481': ['000000', 'dd0000', 'ffce00'], // Germany
  'espn:4469': ['ce1126', 'fcd116', '006b3f'], // Ghana
  'espn:2654': ['00209f', 'd21034'], // Haiti
  'espn:469': ['239f40', 'ffffff', 'da0000'], // Iran
  'espn:4375': ['ce1126', 'ffffff', '000000'], // Iraq
  'espn:4789': ['f77f00', 'ffffff', '009e60'], // Ivory Coast
  'espn:627': ['ffffff', 'bc002d', 'ffffff'], // Japan
  'espn:2917': ['000000', 'ffffff', '007a3d'], // Jordan
  'espn:203': ['006847', 'ffffff', 'ce1126'], // Mexico
  'espn:2869': ['c1272d', '006233'], // Morocco
  'espn:449': ['ae1c28', 'ffffff', '21468b'], // Netherlands
  'espn:2666': ['012169', 'ffffff', 'c8102e'], // New Zealand
  'espn:464': ['ba0c2f', 'ffffff', '00205b'], // Norway
  'espn:2659': ['ffffff', 'da121a', '072357'], // Panama
  'espn:210': ['d52b1e', 'ffffff', '0038a8'], // Paraguay
  'espn:482': ['006600', 'ff0000'], // Portugal
  'espn:4398': ['ffffff', '8a1538'], // Qatar
  'espn:655': ['006c35', 'ffffff'], // Saudi Arabia
  'espn:580': ['005eb8', 'ffffff'], // Scotland
  'espn:654': ['00853f', 'fdef42', 'e31b23'], // Senegal
  'espn:467': ['e03c31', '007749', '001489'], // South Africa
  'espn:451': ['ffffff', 'cd2e3a', '0047a0'], // South Korea
  'espn:164': ['aa151b', 'f1bf00', 'aa151b'], // Spain
  'espn:466': ['006aa7', 'fecc02'], // Sweden
  'espn:475': ['da291c', 'ffffff', 'da291c'], // Switzerland
  'espn:659': ['e70013', 'ffffff'], // Tunisia
  'espn:465': ['e30a17', 'ffffff'], // Türkiye
  'espn:660': ['b22234', 'ffffff', '3c3b6e'], // United States
  'espn:212': ['ffffff', '0038a8'], // Uruguay
  'espn:2570': ['0099b5', 'ffffff', '1eb53a'], // Uzbekistan
  'espn:585': ['e41e20', '000000'], // Albania
  'espn:587': ['0018a8', 'fedf00', 'd50032'], // Andorra
  'espn:579': ['d90012', '0033a0', 'f2a800'], // Armenia
  'espn:581': ['00b5e2', 'ef3340', '509e2f'], // Azerbaijan
  'espn:583': ['cf101a', '007c30'], // Belarus
  'espn:462': ['ffffff', '00966e', 'd62612'], // Bulgaria
  'espn:445': ['ffffff', 'd57800'], // Cyprus
  'espn:479': ['c8102e', 'ffffff'], // Denmark
  'espn:444': ['0072ce', '000000', 'ffffff'], // Estonia
  'espn:447': ['ffffff', 'ed2939', '0065bd'], // Faroe Islands
  'espn:458': ['ffffff', '003580'], // Finland
  'espn:584': ['ffffff', 'ff0000'], // Georgia
  'espn:16721': ['ffffff', 'da000c'], // Gibraltar
  'espn:455': ['0d5eaf', 'ffffff'], // Greece
  'espn:480': ['ce2939', 'ffffff', '477050'], // Hungary
  'espn:470': ['02529c', 'ffffff', 'dc1e35'], // Iceland
  'espn:461': ['ffffff', '0038b8'], // Israel
  'espn:162': ['009246', 'ffffff', 'ce2b37'], // Italy
  'espn:2619': ['00afca', 'fec50c'], // Kazakhstan
  'espn:18272': ['244aa5', 'd0a650', 'ffffff'], // Kosovo
  'espn:456': ['9e3039', 'ffffff', '9e3039'], // Latvia
  'espn:589': ['002b7f', 'ce1126'], // Liechtenstein
  'espn:460': ['fdb913', '006a44', 'c1272d'], // Lithuania
  'espn:582': ['ed2939', 'ffffff', '00a1de'], // Luxembourg
  'espn:453': ['ffffff', 'cf142b'], // Malta
  'espn:483': ['0046ae', 'ffd200', 'cc092f'], // Moldova
  'espn:6775': ['c40308', 'd4af3a'], // Montenegro
  'espn:463': ['d20000', 'ffe600'], // North Macedonia
  'espn:471': ['ffffff', 'dc143c'], // Poland
  'espn:476': ['169b62', 'ffffff', 'ff883e'], // Republic of Ireland
  'espn:473': ['002b7f', 'fcd116', 'ce1126'], // Romania
  'espn:588': ['ffffff', '5eb6e4'], // San Marino
  'espn:6757': ['c6363c', '0c4076', 'ffffff'], // Serbia
  'espn:468': ['ffffff', '0b4ea2', 'ee1c25'], // Slovakia
  'espn:472': ['ffffff', '005da4', 'ed1c24'], // Slovenia
  'espn:457': ['0057b7', 'ffd700'], // Ukraine
  'espn:578': ['ffffff', '00b140', 'c8102e'], // Wales
  'espn:204': ['d52b1e', 'f9e300', '007934'], // Bolivia
  'espn:207': ['ffffff', 'd52b1e', '0039a6'], // Chile
  'espn:214': ['002b7f', 'ffffff', 'ce1126'], // Costa Rica
  'espn:1038': ['009b3a', 'fed100', '000000'], // Jamaica
  'espn:211': ['d91023', 'ffffff', 'd91023'], // Peru
  'espn:213': ['ffcc00', '00247d', 'cf142b'], // Venezuela
  'espn:8942': ['012169', 'ffffff', 'c8102e'], // Anguilla
  'espn:2638': ['ce1126', '000000', '0072c6'], // Antigua and Barbuda
  'espn:2642': ['418fde', 'fbe122', 'c8102e'], // Aruba
  'espn:2640': ['00778b', 'ffc72c', '000000'], // Bahamas
  'espn:2637': ['00267f', 'ffc726', '00267f'], // Barbados
  'espn:2641': ['ce1126', '003f87', 'ce1126'], // Belize
  'espn:2643': ['c8102e', '012169', 'ffffff'], // Bermuda
  'espn:2644': ['012169', 'ffffff', 'c8102e'], // British Virgin Islands
  'espn:2646': ['012169', 'ffffff', 'c8102e'], // Cayman Islands
  'espn:2647': ['002a8f', 'ffffff', 'cf142b'], // Cuba
  'espn:13582': ['006b3f', 'fcd116', 'd41c30'], // Dominica
  'espn:2649': ['002d62', 'ffffff', 'ce1126'], // Dominican Republic
  'espn:2650': ['0f47af', 'ffffff', '0f47af'], // El Salvador
  'espn:2651': ['ce1126', 'fcd116', '007a5e'], // Grenada
  'espn:2652': ['4997d0', 'ffffff', '4997d0'], // Guatemala
  'espn:2653': ['009e49', 'fcd116', 'ce1126'], // Guyana
  'espn:215': ['00bce4', 'ffffff', '00bce4'], // Honduras
  'espn:2655': ['012169', 'ffffff', 'c8102e'], // Montserrat
  'espn:2658': ['0067c6', 'ffffff', '0067c6'], // Nicaragua
  'espn:11766': ['ed0000', 'ffffff', '0050f0'], // Puerto Rico
  'espn:2662': ['009e49', '000000', 'ce1126'], // St. Kitts and Nevis
  'espn:2661': ['65cfff', 'fcd116', '000000'], // St. Lucia
  'espn:13584': ['0072c6', 'fcd116', '009e60'], // St. Vincent and the Grenadines
  'espn:2664': ['377e3f', 'ffffff', 'b40a2d'], // Suriname
  'espn:2627': ['ce1126', 'ffffff', '000000'], // Trinidad and Tobago
  'espn:2665': ['012169', 'ffffff', 'c8102e'], // Turks and Caicos Islands
  'espn:2645': ['ffffff', 'f4c53d', '0f47af'], // US Virgin Islands
}

/** National teams with a color row and no flag row, each for a written reason: their scarf stays the kit's two colors. */
export const NO_FLAG: Readonly<Record<string, string>> = {
  'espn:586': 'core lists it flagless (the flag Unicode does not recommend)', // Northern Ireland
  'espn:10532': 'no flag of its own that is agreed', // French Guiana
  'espn:7657': 'no flag of its own that is agreed', // Guadeloupe
  'espn:2728': 'no flag of its own that is agreed', // Martinique
  'espn:10596': 'no flag of its own that is agreed', // St. Martin
}
