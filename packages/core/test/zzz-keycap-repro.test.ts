import { describe, expect, it } from 'vitest';
import { displayWidth, graphemes } from '../src/text';
import { humanLabel } from '../src/trust/roles';

describe('keycap claim repro', () => {
  it('runs claimed inputs through the real humanLabel', () => {
    for (const [name, s] of [['bare U+0031 U+20E3', '1⃣'], ['with VS16', '1️⃣']] as const) {
      const nfc = s.normalize('NFC');
      console.log('---', name);
      console.log('  in cps :', [...s].map(c => c.codePointAt(0)!.toString(16)).join(' '));
      console.log('  nfc cps:', [...nfc].map(c => c.codePointAt(0)!.toString(16)).join(' '));
      console.log('  clusters:', [...graphemes(nfc)].map(g => [...g].map(c => c.codePointAt(0)!.toString(16)).join('+')));
      const out = humanLabel(s);
      console.log('  OUT    :', JSON.stringify(out), [...out].map(c => c.codePointAt(0)!.toString(16)).join(' '));
      console.log('  width  :', displayWidth(out));
      console.log('  UNCHANGED?', out === s);
    }
    expect(true).toBe(true);
  });
});
