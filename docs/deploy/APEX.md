# Remi on the APEX server

Remi runs on the APEX server as its own program, next to APEX. A "remi" tile on APEX's landing
page takes you to it. You keep building Remi on the Mac; the server only ever **pulls** new
versions from GitHub and never pushes anything.

```
 Mac (build)                GitHub (private repo)                  APEX server (Windows)
 make release  ── push ──▶  Release: remi-x.y.z-windows.zip  ◀── pull ──  update-remi.bat
                                                                          Remi on port 8765
 Work laptop ── browser ──▶ APEX landing page ── "remi" tile ──▶ http://<server>:8765/
```

- APEX and Remi share nothing but that link. Remi keeps its own database on the server
  (`C:\Remi\data`). APEX's Databricks is not involved.
- **No sign-in.** Anyone on the Ninety One network who can reach the server on port 8765 can
  open Remi and change it, just like APEX. Remi still refuses changes that other websites try
  to make through your browser.

---

## One-time setup

### 1. On the Mac: publish the first release

Commit your work, then run:

```sh
make release VERSION=0.2.0
```

This:

1. sets the version;
2. commits and tags it (`v0.2.0`);
3. pushes to GitHub.

GitHub then builds the Windows bundle, installs and tests it on a Windows machine of its own,
and publishes it. Watch it under **Actions › Release** on github.com; it takes about 10
minutes. When it's done, the release page shows `remi-0.2.0-windows.zip`.

### 2. On github.com: make a read-only token

The server uses this token to download releases. It can only read, and only the remi repository.

1. On github.com, open **Settings › Developer settings › Personal access tokens ›
   Fine-grained tokens › Generate new token**.
2. Fill it in:
   - **Name:** `APEX server (read-only)`.
   - **Expiration:** as long as you're happy with; you'll paste a new one when it expires.
   - **Repository access:** *Only select repositories* › `justinstoddart1217/remi`.
   - **Permissions › Repository permissions › Contents:** *Read-only*. Leave everything else
     as it is.
3. Generate it and copy it. You paste it on the server once, in step 5.

### 3. On the server: install Remi

You need administrator rights on the server once, for the firewall and the startup task.

1. Download `remi-<version>-windows.zip` from the release page. Use the server's browser, or
   use your laptop and copy the file across.
2. Right-click the zip, choose **Extract All…**, then open the extracted folder.
3. Double-click **`install-remi.bat`** and say yes when Windows asks for administrator rights.

The installer:

- copies Remi into `C:\Remi`;
- opens port 8765 in Windows Firewall;
- registers a startup task, so Remi runs whenever the server is on (as the low-privilege
  LOCAL SERVICE account);
- starts Remi and prints its address, for example `http://apexserver:8765/`.

Nothing else needs installing. The zip carries its own Python.

Open that address from your laptop. The first-run wizard appears. Set up your plan as you did
on the Mac.

### 4. In APEX: add the "remi" tile

The installer copied the snippet to `C:\Remi\remi-tile.html`.

1. Open APEX's landing-page template, the file in APEX's Flask app that holds the other tiles
   (often `templates/index.html`).
2. Paste **one** of the two versions from the snippet beside the other tiles:
   - **Version 1** copies your existing tile's look.
   - **Version 2** is a ready-styled Ninety One tile.
3. Save and reload APEX.

The link uses `{{ request.host.split(':')[0] }}`, the server name you typed to reach APEX, so
it works whatever name you use. If the page isn't a Jinja template, put the server's name in
instead: `http://apexserver:8765/`.

### 5. The first update

When you next release (step 1 of **Every update**), double-click `C:\Remi\update-remi.bat` on
the server. It asks once for the token from step 2 and saves it encrypted for your Windows
account.

---

## Every update

1. **Mac:** commit your work, then run `make release VERSION=0.2.1` (the next number). Wait for
   **Actions › Release** to go green.
2. **Server:** double-click **`C:\Remi\update-remi.bat`**.

The update:

1. downloads the new release and checks it arrived intact;
2. backs up the database;
3. switches over and restarts Remi;
4. checks the new version answers.

If the new version doesn't start, it goes back to the one before by itself. Your data in
`C:\Remi\data` is never replaced.

**No internet on the server?** Download the zip on your laptop, copy it to the server, and in
an administrator Command Prompt run:

```bat
C:\Remi\update-remi.bat -Zip C:\path\to\remi-0.2.1-windows.zip
```

---

## Day to day

| Double-click | What it does |
| --- | --- |
| `C:\Remi\status-remi.bat` | Is Remi running, which version, and its address |
| `C:\Remi\restart-remi.bat` | Restart, for example after editing `server.env` |
| `C:\Remi\stop-remi.bat` / `start-remi.bat` | Stop it until the next start or reboot / start it again |
| `C:\Remi\update-remi.bat` | Update to the latest release |
| `C:\Remi\rollback-remi.bat` | Go back to the version before the last update |
| `C:\Remi\uninstall-remi.bat` | Remove Remi. Its data folder is kept |

Where things are:

```
C:\Remi\
  server.env        settings: port, extra names, data folder, update repository
  data\             remi.db, charts\, backups\  (never touched by updates)
  logs\             remi.log (Remi's own log), service.log (starts and stops)
  releases\         the current and previous versions
  current.txt       the version that runs; previous.txt, the one before
```

`server.env` settings (run `restart-remi.bat` after a change):

| Setting | Meaning |
| --- | --- |
| `REMI_PORT` | Remi's port (8765). If you change it, change the tile's link too and run `install-remi.bat` again so the firewall follows |
| `REMI_ALLOWED_HOSTS` | Other names you use to reach the server, comma-separated. Remi already answers to the server's own name and addresses |
| `REMI_DATA_DIR` | Where the database lives |
| `REMI_UPDATE_REPO` | The GitHub repository updates come from |

---

## If something goes wrong

- **"Invalid host header" in the browser.** You reached the server by a name Remi doesn't know,
  such as a DNS alias. Add it to `REMI_ALLOWED_HOSTS` in `C:\Remi\server.env` (for example
  `REMI_ALLOWED_HOSTS=apex`), then run `restart-remi.bat`.
- **The laptop can't reach Remi, but it works on the server itself.** Something between them
  blocks port 8765: usually a firewall policy set by IT. Ask IT to allow inbound TCP 8765 to the
  server, as they did for APEX's port.
- **Windows won't run the scripts** (a message about execution policy or signed scripts). A
  company policy on PowerShell blocks them. The `.bat` files already ask for an exception;
  if the policy forbids that too, the scripts need rewriting as plain batch files.
- **Remi doesn't start.** Run `status-remi.bat`: it shows the end of `C:\Remi\logs\remi.log`.
  - "port 8765 is used by another program": set `REMI_PORT` to a free port in `server.env`.
  - "written by a newer Remi": see **Going back past a database change** below.
- **The update says GitHub didn't accept the token.** It has expired. Make a new one (step 2)
  and paste it when asked.

### Going back past a database change

A new version sometimes changes the database. Remi backs it up first, into
`C:\Remi\data\backups\`. The older version then refuses the changed database. To go back
anyway:

1. Run `stop-remi.bat`.
2. Replace `C:\Remi\data\remi.db` with the backup taken just before the update (the newest file
   in `backups\`).
3. Run `rollback-remi.bat`.

Anything entered since the update is lost.

---

## The rules this follows

- **Pull only.** The server downloads from GitHub and never pushes. Its token is read-only and
  limited to the remi repository, so it cannot push even by mistake.
- **Nothing to install on the server.** The bundle carries its own Python and every dependency.
- **Stays local otherwise.** Remi itself makes no outbound calls. Only the update script talks
  to GitHub, and only when you run it.
- **The Ninety One fonts stay private.** The bundle includes them, so only publish releases in
  this private repository.
