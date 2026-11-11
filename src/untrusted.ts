// Text that other sessions wrote (their names, topics, questions) and text the
// model drafted reach this mod's rules and tool results. Two helpers keep it
// in its place: one folds it before the approval words are looked for, so
// "p​ush" or "рush" with a Cyrillic р still reads as push; the other quotes it
// for the model as data, on one line and cut short.

// Letters from other scripts that look like Latin ones, the usual stand-ins.
const LOOKALIKES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', І: 'I', Ѕ: 'S',
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  Α: 'A', Β: 'B', Ε: 'E', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Χ: 'X',
}
const LOOKALIKE_PATTERN = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu')

// Zero-width spaces and joiners, soft hyphens, direction marks: invisible, so dropped.
const INVISIBLE = /\p{Cf}/gu
// Letters spelled out one by one: "p u s h", "p.u.s.h", "m-e-r-g-e".
const SPELLED_OUT = /(?<![\p{L}\p{N}])\p{L}(?:[\s.\-_*·|/\\]+\p{L}(?![\p{L}\p{N}]))+/gu

// The text as the approval rule reads it. Only for looking: what is sent stays as written.
export function foldForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(LOOKALIKE_PATTERN, letter => LOOKALIKES[letter] ?? letter)
    .replace(SPELLED_OUT, run => run.replace(/[^\p{L}]/gu, ''))
}

// One line, control and invisible characters out, cut to `max`.
export function oneLine(text: string, max: number): string {
  const line = text
    .replace(INVISIBLE, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// Cut to `max` at the last whole word, with … when anything was cut.
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

// The same line in JSON quotes: how text from elsewhere reaches the model.
export function quoted(text: string, max = 120): string {
  return JSON.stringify(oneLine(text, max))
}
