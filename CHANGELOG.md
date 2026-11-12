# tracket

## 0.4.0

### Minor Changes

- [#8](https://github.com/Hydhen/tracket/pull/8) [`e66b244`](https://github.com/Hydhen/tracket/commit/e66b244e1c856120b96d8df4073724fd3c6a1484) Thanks [@Hydhen](https://github.com/Hydhen)! - The window has its own title bar, in the colours of the app, with the logo, the title and the window buttons. Drag it to move the window and double-click it to maximise.

- [#8](https://github.com/Hydhen/tracket/pull/8) [`e66b244`](https://github.com/Hydhen/tracket/commit/e66b244e1c856120b96d8df4073724fd3c6a1484) Thanks [@Hydhen](https://github.com/Hydhen)! - While a timer runs, a rounded notch in the middle of the title bar shows a red light and the running time. Point at it and a button shrinks the whole window to that notch, which stays on top of the other windows; a button on it brings the app back.

## 0.3.0

### Minor Changes

- [`1637733`](https://github.com/Hydhen/tracket/commit/1637733bfd0b2cfa404b14a9be7f3ea8b50ecb44) Thanks [@Hydhen](https://github.com/Hydhen)! - Add a comment to a ticket: the "Add comment" button above its comments opens an editor (Ctrl+Enter posts). Type @ to mention someone who can see the ticket, with the list of people right under the cursor. Your own comments can be edited with the pencil that shows when you point at them.

### Patch Changes

- [`d47c503`](https://github.com/Hydhen/tracket/commit/d47c50397c4f85d69241a7eebc7810cfe23ddf75) Thanks [@Hydhen](https://github.com/Hydhen)! - The loading spinner is now the chevrons of the logo, the light passing from one to the next. It also shows while the app starts, on the system theme's background, instead of a blank white window: the window appears once the page has loaded.

- [`b46c05e`](https://github.com/Hydhen/tracket/commit/b46c05ec4f02a253188a5e4b4d2742664128ff6c) Thanks [@Hydhen](https://github.com/Hydhen)! - Show the pictures of people who haven't uploaded one (their initials), which the installed app was blocking.

- [`e1e0ff9`](https://github.com/Hydhen/tracket/commit/e1e0ff9befdef0a538800b7fda69349185d759e6) Thanks [@Hydhen](https://github.com/Hydhen)! - When Jira asks for more fields while you move a ticket, what you already filled in stays until the ticket has moved, so you don't type it again. The time spent asked by a move is now sent the way Jira expects it (as text, like "90m").

- [`bbe6cfa`](https://github.com/Hydhen/tracket/commit/bbe6cfa66858d3cd45d6db28756b52eb5721111a) Thanks [@Hydhen](https://github.com/Hydhen)! - The window's title bar follows the theme chosen in Tracket (light or dark), not only the one of Windows.

## 0.2.1

### Patch Changes

- [`af5be8a`](https://github.com/Hydhen/tracket/commit/af5be8ae273eee98a53010597419ed7f8b20b7a8) Thanks [@Hydhen](https://github.com/Hydhen)! - Keep settings, timers and the tree in a file shared by every build, so a development build sees the same configuration as the installed app. Your existing settings are moved over the first time this version starts.

## 0.2.0

### Minor Changes

- [`cb1ff96`](https://github.com/Hydhen/tracket/commit/cb1ff961ac73b5b06a922c3818fa40b5860a9338) Thanks [@Hydhen](https://github.com/Hydhen)! - Keep a parent ticket pinned at the top of the tree while you scroll through its children.

### Patch Changes

- [`cb1ff96`](https://github.com/Hydhen/tracket/commit/cb1ff961ac73b5b06a922c3818fa40b5860a9338) Thanks [@Hydhen](https://github.com/Hydhen)! - Fix ticket titles showing through the group headers when scrolling the ticket list.
