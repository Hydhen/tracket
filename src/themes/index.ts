import { themeDef, type ThemeId } from '@/lib/themes'

/**
 * What each fun theme needs (its rules and its fonts), as a module that is only loaded when the theme is chosen: the
 * others cost nothing. A theme that isn't built yet has no entry, and looks like the theme it is built on.
 * The standard themes need nothing, they are in index.css.
 */
const LOADERS: Partial<Record<ThemeId, () => Promise<unknown>>> = {
  brutalist: () => import('./brutalist'),
  terminal: () => import('./terminal'),
}

/** Whether the theme can be chosen: the standard ones always, a fun one once it is built */
export const isBuilt = (id: ThemeId): boolean => themeDef(id).group === 'standard' || id in LOADERS

/** Resolves once the theme's rules are in the page (and so can be switched on without a flash of something else) */
export const loadTheme = (id: ThemeId): Promise<unknown> => LOADERS[id]?.() ?? Promise.resolve()
