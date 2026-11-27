/**
 * The pixel stadium's sound (plugin 0.13.0), as Arturo heard it in the desktop app on Claude Code 2.1.330 (the demo's
 * `/demo sound` prototype, Nov 23, 2026) and approved: "everything work well, nice". The app makes the sound from
 * these numbers (`ThemeSound`), no recording. A change to one is a change to what a person hears, so it is made here
 * by hand, with a new listen in the app, never by copying the plugin's values back.
 */
const WHISTLE = {
  layers: [
    { wave: 'sine', notes: [2_900], gain: 0.25, attack: 0.01, release: 0.25, tremolo: { hz: 28, depth: 0.7 } },
    { wave: 'sine', notes: [3_000], gain: 0.25, attack: 0.01, release: 0.25, tremolo: { hz: 28, depth: 0.7 } },
  ],
}
const cues = { click: WHISTLE }

/** The empty stadium: faint wind. */
export const IDLE_SOUND = {
  ambience: { layers: [{ wave: 'pink', drone: true, gain: 0.08, filter: { type: 'lowpass', hz: 350 }, tremolo: { hz: 0.1, depth: 0.6 } }] },
  cues,
}

/** The pinned team's match in play: the crowd's murmur. */
export const LIVE_SOUND = {
  ambience: {
    layers: [
      { wave: 'brown', drone: true, gain: 0.25, filter: { type: 'lowpass', hz: 500 } },
      { wave: 'pink', drone: true, gain: 0.12, filter: { type: 'bandpass', hz: 900 }, tremolo: { hz: 0.15, depth: 0.4 } },
      { wave: 'crackle', scatter: 0.4, gain: 0.08, attack: 0.01, release: 0.4 },
    ],
    reverb: 0.4,
  },
  cues,
}

/** The pinned team's goal: the roar (the prototype's roar 1). */
export const GOAL_SOUND = {
  ambience: {
    layers: [
      { wave: 'pink', drone: true, gain: 0.6, filter: { type: 'lowpass', hz: 700, to: 3_000 } },
      { wave: 'brown', drone: true, gain: 0.4 },
      { wave: 'crackle', scatter: 8, gain: 0.3, attack: 0.005, release: 0.15 },
    ],
    reverb: 0.6,
  },
  cues,
}

/** The other side's goal: the groan. */
export const OTHER_GOAL_SOUND = {
  ambience: {
    layers: [
      { wave: 'brown', drone: true, gain: 0.3, filter: { type: 'lowpass', hz: 600, to: 200 } },
      { wave: 'pink', drone: true, gain: 0.06, filter: { type: 'lowpass', hz: 400 } },
    ],
    reverb: 0.5,
  },
  cues,
}
