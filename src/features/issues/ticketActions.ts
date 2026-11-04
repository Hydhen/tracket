import { createContext } from 'react'

export interface TicketActions {
  /** Opens a ticket in the side view, falling back to the browser when the app can't load it */
  openInSide: (key: string) => void
  /** Opens the settings on the repository link of a Jira project */
  linkRepo: (projectKey: string) => void
}

export const TicketActionsContext = createContext<TicketActions>({ openInSide: () => {}, linkRepo: () => {} })
