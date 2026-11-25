# tracket

## 0.8.0

### Minor Changes

- [`ff2e925`](https://github.com/Hydhen/tracket/commit/ff2e925a0cc60a09f87261a25097d9fa132146eb) Thanks [@Hydhen](https://github.com/Hydhen)! - A new Appearance page in the settings to choose the theme, with six fun themes besides System, Light and Dark: Terminal (green on black in monospace, with a moving line and CRT edges you can switch off), Neo-brutalist (a cream page with thick black outlines and hard shadows) Mission control (amber on black, with a T+ countdown on every running timer and glitches you can switch off) Quest log (blue windows, white borders and a pixel font, like an old role-playing game) Neon cyberpunk (cut corners, neon colours and scanlines you can switch off) and Windows 98 (bevelled grey windows, a navy title bar, system fonts).

## 0.7.7

### Patch Changes

- [`8ad2d41`](https://github.com/Hydhen/tracket/commit/8ad2d418fcb0a5ad62dd2c2e45dbeb24190f8183) Thanks [@Hydhen](https://github.com/Hydhen)! - The icon of a ticket mentioned in a comment stays in the line of text, instead of dropping below it and leaving a gap.

- [`8672f86`](https://github.com/Hydhen/tracket/commit/8672f86e11cb8c3fc0256af33177fd659e3a6c02) Thanks [@Hydhen](https://github.com/Hydhen)! - The title of a ticket moves up into its header as you scroll, and the timer bar widens to the whole pane when it sticks to the top.

## 0.7.6

### Patch Changes

- [`3e14775`](https://github.com/Hydhen/tracket/commit/3e1477530bb00446c572abc70923124977dafe9a) Thanks [@Hydhen](https://github.com/Hydhen)! - The timer bar of a ticket stays at the top while you scroll, under the ticket's header and as wide as it.

## 0.7.5

### Patch Changes

- [`d3e9aa5`](https://github.com/Hydhen/tracket/commit/d3e9aa58654619863c6b47ee1014ca530e3749ee) Thanks [@Hydhen](https://github.com/Hydhen)! - When a ticket's worktree folder is in the way (a leftover folder that git no longer knows, or the branch already checked out in another worktree), quick start now asks what to do instead of opening the wrong folder: use what is there, delete it and create a fresh worktree, or create it in a folder of your own picked with a folder picker.

## 0.7.4

### Patch Changes

- [`f55b99f`](https://github.com/Hydhen/tracket/commit/f55b99ff6615a4842910bacb78e4a2b700639560) Thanks [@Hydhen](https://github.com/Hydhen)! - Ctrl+Enter submits the dialogs that edit or move tickets, and the form that logs time, from whichever field you are typing in.

## 0.7.3

### Patch Changes

- [#19](https://github.com/Hydhen/tracket/pull/19) [`99ad5bc`](https://github.com/Hydhen/tracket/commit/99ad5bcd841de949a00ddc621078bcc55757ad6b) Thanks [@Hydhen](https://github.com/Hydhen)! - A small red dot shows on Tracket's icon in the Windows taskbar while at least one timer is running.

## 0.7.2

### Patch Changes

- [#18](https://github.com/Hydhen/tracket/pull/18) [`272ff8e`](https://github.com/Hydhen/tracket/commit/272ff8e56f5c0bd892f638b2fbcc24ad558f3f6c) Thanks [@Hydhen](https://github.com/Hydhen)! - Paste a picture (a screenshot, a copied image) into a comment or a description and it is attached to the ticket and shown where you pasted it. It is attached when you post or save, so cancelling leaves nothing on the ticket.

- [#18](https://github.com/Hydhen/tracket/pull/18) [`03d37ad`](https://github.com/Hydhen/tracket/commit/03d37ad45f432a8f61e42e705d3e46dd245dce53) Thanks [@Hydhen](https://github.com/Hydhen)! - Moving a ticket no longer asks for required fields the ticket already has (a component, a category…): they are checked on the ticket when you move it, and are only asked for when one is empty. The ones left out stay under "Also on Jira's screen for this move" if you want to change them.

## 0.7.1

### Patch Changes

- [#17](https://github.com/Hydhen/tracket/pull/17) [`87ee98d`](https://github.com/Hydhen/tracket/commit/87ee98dfff447df398e277e79a705b8f0220414f) Thanks [@Hydhen](https://github.com/Hydhen)! - The side view now opens in the layout that suits the window: side by side when the window is wider than tall, stacked when it is taller. The button on the divider switches the open side view to the other layout, and the next one opens from the window's shape again. The buttons on the divider also show the pointer cursor instead of the resize one.

## 0.7.0

### Minor Changes

- [#16](https://github.com/Hydhen/tracket/pull/16) [`0070143`](https://github.com/Hydhen/tracket/commit/0070143126fbefbc6c6597cec0589afd3f8b6880) Thanks [@Hydhen](https://github.com/Hydhen)! - Drag tickets onto the new "Assign to…" zone to give them to someone. Your favorite people (up to 12, chosen in Settings under Favorite assignees) come first, with a search for anyone else. Undo gives the tickets back.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`893082b`](https://github.com/Hydhen/tracket/commit/893082b816addd5628ee67cf3e5a3a291e0d3afb) Thanks [@Hydhen](https://github.com/Hydhen)! - Tickets dragged from the Board now get the same drop zones as the ones of the lists: edit their fields, assign them to someone, unassign them, or move them to another status. Dropping them on the Open list still takes them.

- [#14](https://github.com/Hydhen/tracket/pull/14) [`a0777fd`](https://github.com/Hydhen/tracket/commit/a0777fdb70271917fbc2f64d8b01424b7b9d5940) Thanks [@Hydhen](https://github.com/Hydhen)! - The side view can now sit below the main view instead of beside it. Use the new button next to the one that closes the side view to switch between the two layouts; Tracket remembers your choice.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`dc832f1`](https://github.com/Hydhen/tracket/commit/dc832f1174714655965b1f3bea8ff29d4da3a26b) Thanks [@Hydhen](https://github.com/Hydhen)! - Pictures and videos open full size in a viewer. Zoom with the buttons, the wheel or a double-click, drag to move around, and take it to full screen.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`62df517`](https://github.com/Hydhen/tracket/commit/62df517ea4a0a238fc60beec1c2785432063d4ae) Thanks [@Hydhen](https://github.com/Hydhen)! - A new "Resolve defaults" page in Settings: choose the fields (a resolution, a comment, the time spent, components…) and the values they get when you move a ticket to a done status. When these cover everything Jira asks for, the ticket moves straight away, without the dialog; otherwise the dialog opens with them already filled in.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`dc832f1`](https://github.com/Hydhen/tracket/commit/dc832f1174714655965b1f3bea8ff29d4da3a26b) Thanks [@Hydhen](https://github.com/Hydhen)! - Videos attached to a ticket now play, in the description, in the comments and from the attachments list. Pictures embedded in a description or a comment show too, and the list opens pictures as well.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`dc832f1`](https://github.com/Hydhen/tracket/commit/dc832f1174714655965b1f3bea8ff29d4da3a26b) Thanks [@Hydhen](https://github.com/Hydhen)! - The ticket view has a refresh button and an "Edit metadata" button next to the others.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`dc832f1`](https://github.com/Hydhen/tracket/commit/dc832f1174714655965b1f3bea8ff29d4da3a26b) Thanks [@Hydhen](https://github.com/Hydhen)! - The top row of a ticket stays in view while you scroll: its key, its buttons and, once you scroll past the big title, a shortened title.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`dc832f1`](https://github.com/Hydhen/tracket/commit/dc832f1174714655965b1f3bea8ff29d4da3a26b) Thanks [@Hydhen](https://github.com/Hydhen)! - "Unassign" now sits below "Assign to…" wherever you drag tickets, not only from the Board.

- [#16](https://github.com/Hydhen/tracket/pull/16) [`dc832f1`](https://github.com/Hydhen/tracket/commit/dc832f1174714655965b1f3bea8ff29d4da3a26b) Thanks [@Hydhen](https://github.com/Hydhen)! - A new "What's new" view lists what changed in each version, in a few readable lines. It opens on its own the first time you start a new version, and from Settings, under About.

### Patch Changes

- [#16](https://github.com/Hydhen/tracket/pull/16) [`bb34553`](https://github.com/Hydhen/tracket/commit/bb3455318dfe4fa392421bcf1e904d4469a9f7c8) Thanks [@Hydhen](https://github.com/Hydhen)! - In the bulk edit dialog, the arrow keys on the "Add" and "Remove" menus of a field such as Components now only spin through the options instead of adding each one: press Space or Tab to add the one shown, Delete to go back to "Choose…", and Enter to open the menu.

- [#15](https://github.com/Hydhen/tracket/pull/15) [`80d783d`](https://github.com/Hydhen/tracket/commit/80d783dc2052bcc051a2348706500906e262a215) Thanks [@Hydhen](https://github.com/Hydhen)! - The main view and the side view now share the space evenly when the side view opens, on the Board too. Double-clicking the divider between them brings the split back to even.

## 0.6.0

### Minor Changes

- [#13](https://github.com/Hydhen/tracket/pull/13) [`3d73201`](https://github.com/Hydhen/tracket/commit/3d73201c608567d88b843d49df33824820ca654c) Thanks [@Hydhen](https://github.com/Hydhen)! - A new Board tab next to Open, Closed and Tree: explore a Jira board (its current sprint, another sprint, the backlog or the whole board) or any project, and feed your Open list from it. Boards and projects are listed by project name and can be searched. Columns can be folded into a narrow strip, and the board remembers which ones. Drag a ticket onto the Open list, or use "Assign to me" on it, to take it. Tickets that someone else has ask for a confirmation first, and Undo gives them back. Dragging a ticket of the Open list out onto the board unassigns it. The lists change right away and are not reloaded from Jira afterwards, since its search is slow to show the change.

- [#13](https://github.com/Hydhen/tracket/pull/13) [`3d73201`](https://github.com/Hydhen/tracket/commit/3d73201c608567d88b843d49df33824820ca654c) Thanks [@Hydhen](https://github.com/Hydhen)! - Starting work on a ticket that no project of the Quick start settings fits now opens those settings with a new entry for the ticket's Jira project, and the cursor in its name. Before, that only happened when there were no projects at all; otherwise the button just showed an error.

## 0.5.0

### Minor Changes

- [#10](https://github.com/Hydhen/tracket/pull/10) [`5d7b4d3`](https://github.com/Hydhen/tracket/commit/5d7b4d3256e41e02d1c8a9fda54ca643de4819eb) Thanks [@Hydhen](https://github.com/Hydhen)! - In the settings, each field the bulk edit starts with can now have a default value (a priority, an assignee, labels to add…), filled in when the dialog opens. Those fields are also reordered by dragging their handle instead of with the up and down arrows (the arrow keys still work on the handle).

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
