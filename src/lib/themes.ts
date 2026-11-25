/**
 * Every theme there is, in the order the picker lists them. The choice is one value for all of them: System, Light and
 * Dark (the standard ones, which follow the usual light and dark colours) and the fun ones, which are looks of their
 * own. A fun theme is not light or dark by choice: it says which of the two it is built on (`scheme`), and the app
 * follows that instead of the system. It is not held to the contrast rules of the standard themes.
 */

export type ThemeGroup = 'standard' | 'fun'

/** `system` is light or dark as Windows says; the others are fixed */
export type Scheme = 'light' | 'dark' | 'system'

/**
 * A choice that only this theme has, on or off. It is shown in the Appearance settings while the theme is the one in
 * use, and it reaches the theme's rules as an attribute of the page: `data-opt-<id>="off"` when it is off, none when
 * it is on (so a theme's CSS only has to say what switching it off does).
 */
export interface ThemeOption {
  id: string
  label: string
  hint: string
  default: boolean
}

export interface ThemeDef {
  id: string
  label: string
  group: ThemeGroup
  scheme: Scheme
  /** Three colours that show what the theme looks like in the picker: background, panel, accent */
  swatch: readonly [string, string, string]
  options?: readonly ThemeOption[]
}

export const THEMES = [
  { id: 'system', label: 'System', group: 'standard', scheme: 'system', swatch: ['#ffffff', '#f5f5f5', '#1c1c1c'] },
  { id: 'light', label: 'Light', group: 'standard', scheme: 'light', swatch: ['#ffffff', '#f5f5f5', '#1c1c1c'] },
  { id: 'dark', label: 'Dark', group: 'standard', scheme: 'dark', swatch: ['#1c1c1c', '#2e2e2e', '#ebebeb'] },
  // Light: the silver of its windows is its "face", and its native controls should be light too
  { id: 'win98', label: 'Windows 98', group: 'fun', scheme: 'light', swatch: ['#008080', '#c0c0c0', '#000080'] },
  { id: 'neon', label: 'Neon cyberpunk', group: 'fun', scheme: 'dark', swatch: ['#07060f', '#110e22', '#00f0ff'] },
  {
    id: 'terminal',
    label: 'Terminal',
    group: 'fun',
    scheme: 'dark',
    swatch: ['#020b04', '#041109', '#4dff7c'],
    options: [
      { id: 'sweep', label: 'Moving line', hint: 'A glowing line that goes down the screen now and then', default: true },
      { id: 'vignette', label: 'Vignette', hint: 'Dark, rounded edges, softer towards them', default: true },
    ],
  },
  {
    id: 'mission',
    label: 'Mission control',
    group: 'fun',
    scheme: 'dark',
    swatch: ['#0a0805', '#0e0a05', '#ffb000'],
    options: [
      {
        id: 'glitch',
        label: 'Glitches',
        hint: 'Now and then the screen tears, splits into colours and shakes, as if something got into it',
        default: true,
      },
    ],
  },
  { id: 'brutalist', label: 'Neo-brutalist', group: 'fun', scheme: 'light', swatch: ['#fff8e1', '#ffd23f', '#ff6b9d'] },
  { id: 'quest', label: 'Quest log', group: 'fun', scheme: 'dark', swatch: ['#040827', '#0b1760', '#ffd23f'] },
] as const satisfies readonly ThemeDef[]

export type ThemeId = (typeof THEMES)[number]['id']
export type StandardThemeId = Extract<(typeof THEMES)[number], { group: 'standard' }>['id']

const BY_ID: ReadonlyMap<string, ThemeDef> = new Map(THEMES.map((t) => [t.id, t]))

export const DEFAULT_THEME: ThemeId = 'system'

export const isThemeId = (value: unknown): value is ThemeId => typeof value === 'string' && BY_ID.has(value)

export const themeDef = (id: ThemeId): ThemeDef => BY_ID.get(id)!
