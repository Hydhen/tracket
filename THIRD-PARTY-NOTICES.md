# Third-party notices

Tracket is built on open-source software. This file lists what is bundled that isn't covered by the
dependency licenses in `package-lock.json` and `src-tauri/Cargo.lock`.

## Logos used by the "Start working" buttons

These identify the app a worktree opens in. Tracket is not affiliated with or endorsed by their owners.

### herdr

`src/assets/launchers/herdr.svg` and the outline in `src/features/workspace/LauncherOutline.tsx` are adapted
from the herdr logo, <https://github.com/herdrdev/herdr/blob/HEAD/assets/logo.svg>.

- License: Apache License 2.0. The full text is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
- Changes: the ram path is placed on a plain tile, and cropped to that tile for the line version.

### Visual Studio Code

`src/assets/launchers/vscode.svg` and the outline in `src/features/workspace/LauncherOutline.tsx` are the
Visual Studio Code icon. "Visual Studio Code" and its logo are trademarks of Microsoft Corporation, used here
only to name the application that is opened.

## Fonts

All under the SIL Open Font License 1.1, whose copyright notices are kept in `site/fonts/`.

- **Geist Variable**, via `@fontsource-variable/geist`: the app and the website.
- **Martian Mono**, via `@fontsource-variable/martian-mono`: the website only.

## Animation library (website only)

**GSAP** and its **ScrollTrigger** plugin, version 3.15.1, Copyright GreenSock, under the GSAP "no charge" Standard
License (<https://gsap.com/standard-license>). Their copyright notices are kept at the top of
`site/vendor/gsap.min.js` and `site/vendor/ScrollTrigger.min.js`.

GSAP is used only by the project's website in `site/`. The Tracket application does not include it: it isn't a
dependency of the app, isn't in its source, and isn't in the installer.

## The Tracket icon

`branding/icon.svg`, and the icons generated from it in `src-tauri/icons`, are original to this project and
covered by its MIT license.
