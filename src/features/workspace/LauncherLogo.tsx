import { launcherLogo, type LauncherId } from './launcher'

/** The app's logo, for a button or a card: decorative, since the app's name is always written beside it or in the tooltip. */
export function LauncherLogo({ id, className }: { id: LauncherId; className?: string }) {
  return <img src={launcherLogo(id)} alt="" draggable={false} className={className} />
}
