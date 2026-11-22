import { describe, expect, test } from 'claude-code/testing'
import { type CelebrationElements, goalRow, resultRow } from './celebration'

/**
 * The keys of the celebration's middle row. A mount shows a Box's key and never a Text's (celebration-tree.test.tsx
 * compares every prop a mount shows), so these cases call the row's two functions with a Text constructor that keeps
 * the props it was handed, the key among them, and compare the whole element each function returns.
 *
 * Two things here are the engine's and not the plugin's: that it hands a function tag its `key` among the props (the
 * first case is the control for it: red there means the engine changed, not the plugin), and the shape the children
 * arrive in (a list, a lone child included).
 */
type Kept = { type: 'Text'; props: Record<string, unknown> }
const Text = ((props: Record<string, unknown>): Kept => ({ type: 'Text', props })) as unknown as CelebrationElements['Text']
const kept = (element: unknown): Kept => element as Kept
const word = { type: 'Text', props: { key: 'goal-word', bold: true, color: 'success', children: ['GOAL!'] } }

describe("the middle row's keys", () => {
  test('the control: the engine hands a function tag the key it was written with', async () => {
    expect(kept(<Text key="k">x</Text>).props.key).toBe('k')
  })

  test('a goal beside the mascot: the row is `row-1`, and the word inside it `goal-word`', async () => {
    expect(kept(goalRow({ Text }, 'GOAL!', 'Liverpool'))).toEqual({
      type: 'Text',
      props: { key: 'row-1', wrap: 'truncate-end', children: [word, ' Liverpool'] },
    })
  })

  test("a goal on one row: the row takes the caller's key, and the word keeps `goal-word`", async () => {
    expect(kept(goalRow({ Text }, 'GOAL!', "Liverpool 22'", 'row-0'))).toEqual({
      type: 'Text',
      props: { key: 'row-0', wrap: 'truncate-end', children: [word, " Liverpool 22'"] },
    })
  })

  test("full time: the row is `row-1`, or the caller's key", async () => {
    expect(kept(resultRow({ Text }, 'Full time · LAS 3–6 LIV'))).toEqual({
      type: 'Text',
      props: { key: 'row-1', wrap: 'truncate-end', children: ['Full time · LAS 3–6 LIV'] },
    })
    expect(kept(resultRow({ Text }, 'Full time', 'row-0')).props.key).toBe('row-0')
  })
})
