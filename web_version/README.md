# ScratchJr Web

ScratchJr in the browser for a classroom network. One PC runs the server; students open its address on any computer or tablet on the same network, log in, and find their own projects. Work saves to the server as they go.

```
 Student PCs / tablets                 Server PC (this folder)
 ---------------------                 -----------------------
 http://192.168.9.1   ── log in ──▶    Node.js + Express
 ScratchJr in the browser  ◀── projects, characters, sounds ──▶  SQLite via Prisma
```

It is the same ScratchJr as the desktop app: the build takes it straight from `../desktop/src/app`, so a fix there reaches the web version on the next build.

## What students get

- **Log in or create an account** with a username and password. Usernames are 3 to 24 letters or numbers (`.` `_` `-` allowed) and are not case sensitive; passwords need at least 4 characters.
- **My Projects shows only their own work.** Nobody can see or change another student's projects.
- **Saving is automatic.** Every change goes to the server as it is made, and the editor saves the open project every 5 seconds while it is changing. The dot on the account button shows the state: green is saved, yellow is saving, red is "can't reach the server".
- **If the network drops,** the work is kept in the browser and saves by itself when the server is back, including after moving to another page. It is also sent the next time the same student logs in on that computer.
- **The account button** in the bottom-right corner has:
  - **Save project to computer** (in the editor): downloads the open project as an `.sjr` file to the Downloads folder.
  - **Load project from computer**: adds an `.sjr` file to My Projects, with a gift bow on it.
  - **Log out**: saves the open project first.

`.sjr` is ScratchJr's own sharing format, so files move freely between the web version, the desktop app (**File > Load Project from Computer**) and ScratchJr on iPad and Android.

## Setting up the server

Needs **Node.js 22 or newer** on the server PC, and internet access during setup (npm downloads the packages and Prisma's database engine). Students only need a browser from the last few years: Chrome, Edge, Firefox or Safari.

From this folder:

```
npm install
npm run setup
npm run build
npm start
```

| Command | What it does | When |
| --- | --- | --- |
| `npm run setup` | Creates `.env` from `.env.example` if there is none, and creates or updates the database in `data/` | Once, and after updating this folder. Safe to run again: existing students and projects are kept |
| `npm run build` | Builds the app into `public/app` from `../desktop/src/app` | Once, and after any change to ScratchJr itself |
| `npm start` | Runs the server | Every time |

`npm start` prints the addresses students should open, such as `http://192.168.9.1/`. The first time, Windows asks whether Node.js may use the network: allow **Private networks**.

To run the server somewhere else, build it here first, then copy the whole `web_version` folder, `public/app` included. The build needs the rest of this repository; the server does not.

## Settings

In `.env` (see `.env.example`):

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `80` | Port 80 lets students type just the address. Use `8080` if another program already has port 80; they then open `http://192.168.9.1:8080/` |
| `HOST` | `0.0.0.0` | Accept connections from the network. `127.0.0.1` allows only the server PC |
| `SESSION_HOURS` | `12` | How long a login lasts. Keep it to about a school day on shared PCs, so a student who forgets to log out does not leave their account open |
| `DATABASE_URL` | `file:../data/scratchjr-web.db` | Where projects are stored, relative to `prisma/schema.prisma` |
| `HTTPS_CERT`, `HTTPS_KEY` | not set | Turn on HTTPS; see below |

## Recording sounds and using the camera

Browsers only allow the microphone and camera on a secure page: HTTPS, or `localhost` on the server PC itself. Over plain `http://192.168.x.x` ScratchJr hides the record and camera buttons; everything else works.

To turn them on, serve over HTTPS. With [mkcert](https://github.com/FiloSottile/mkcert):

```
mkcert -install
mkcert -cert-file certs/server.pem -key-file certs/server-key.pem 192.168.9.1 localhost
```

Then set `HTTPS_CERT=certs/server.pem`, `HTTPS_KEY=certs/server-key.pem` and `PORT=443` in `.env`. Each student device must trust mkcert's root certificate (`mkcert -CAROOT` shows where it is), or the browser will warn about the page.

## For the teacher

**A student forgot their password:**

```
npm run reset-password -- student1 newpassword
```

It also logs them out everywhere. Their projects are not touched.

**Backups:** everything is in one file, `data/scratchjr-web.db`. Stop the server, copy the file, start it again. To restore, stop the server and put the copy back.

## Things to know

- **One account on two devices at once:** both work, and the last save of a project wins.
- **Closing the tab** within 5 seconds of a change can lose that change. Going back to My Projects, or logging out, always saves.
- **Save project to computer** downloads to the browser's Downloads folder. A browser set to "ask where to save each file" opens a Save As dialog instead.
- **Passwords travel unencrypted over plain HTTP.** On a school network that is usually acceptable for this use; HTTPS (above) encrypts them.
- **Recorded sounds** are saved as webm in the browser, as they are in the desktop app.

## How it works

ScratchJr expects a tablet underneath it: it calls `window.tablet` synchronously and keeps projects in SQL tables. `client/webTablet.js` is that tablet for the browser, as `desktop/src/electronClient.js` is for Electron.

- **Each page builds ScratchJr's tables in memory** with sql.js (SQLite compiled to WebAssembly) from the student's data on the server, and runs ScratchJr's SQL against them unchanged.
- **Triggers note every row a statement changes,** and those rows go straight to `POST /api/sync`. Characters, backgrounds, thumbnails and recordings go the same way.
- **The server never runs SQL from a browser.** It accepts only rows of ScratchJr's three tables with their known columns, and only for the logged-in student. Prisma keeps them in SQLite, keyed by student. Each page load gets its own block of row numbers, so two tabs cannot pick the same project number.
- **Logins** use scrypt password hashes and an HttpOnly, SameSite cookie whose token is stored only as a hash. Repeated wrong passwords for one name are slowed down, and writes from other sites are refused.

| Path | What it is |
| --- | --- |
| `server/` | Express app, login and sessions (`auth.js`), the student's data (`store.js`), what a sync may contain (`tables.js`) |
| `prisma/` | Database schema and migrations |
| `client/` | The web tablet, account button, microphone and camera, bundled into `public/app/web.js` |
| `static/` | The login page |
| `scripts/` | `build`, `setup` and `reset-password` |
| `test/` | `npm test`: the API against a throwaway database |
