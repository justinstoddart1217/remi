# Remi on the APEX server

Remi runs on the APEX server as its own program, next to APEX, and opens at
**`https://apex.ny1.ninetyone.com/remi/`**. APEX's IIS serves that address and passes it to Remi,
which listens only on the server itself (`127.0.0.1:8765`). You keep building Remi on the Mac.
The server only ever **pulls** new versions from GitHub and never pushes anything.

```
 Mac (build)               GitHub (private repo)                    APEX server (Windows)
 make release ── push ──▶  Release: remi-x.y.z-windows.zip  ◀── pull ──  update-remi.bat

 Work laptop ── https://apex.ny1.ninetyone.com/remi/ ──▶ IIS ── strips /remi ──▶ Remi on 127.0.0.1:8765
             (APEX's "remi" tile links to /remi/)
```

- **What APEX and Remi share:** only the address. APEX's landing page carries the tile, and
  APEX's IIS rule forwards `/remi/` to Remi (APEX's `docs/remi/IIS_RULE.md`). Remi keeps its
  own database on the server (`C:\Remi\data`); APEX's Databricks is not involved.
- **No firewall port and no plain-http address.** Remi can't be reached except through IIS.
- **No sign-in.** Anyone who can open `https://apex.ny1.ninetyone.com/remi/` can open Remi and
  change it, just like APEX. Remi still refuses changes that other websites try to make
  through your browser.

The design decisions are in [ADR-0013](../decisions/0013-behind-apex-iis.md), which amends
[ADR-0012](../decisions/0012-apex-server-bundle.md).

---

## One-time setup

### 1. On the Mac: publish a release

Commit your work, then run:

```sh
make release VERSION=0.3.0
```

This sets the version, commits and tags it (`v0.3.0`), and pushes to GitHub. GitHub then:

1. builds the Windows bundle;
2. installs and tests it on a Windows machine of its own, both behind a proxy and in server
   mode;
3. publishes it.

Watch it under **Actions › Release** on github.com; it takes about 5 minutes. When it's done,
the release page shows `remi-0.3.0-windows.zip`.

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
3. Generate it and copy it. The server asks for it the first time you update (step 5).

### 3. On the server: install Remi behind the proxy

You need administrator rights on the server once, for the startup task.

1. Download `remi-<version>-windows.zip` from the release page. Use the server's browser, or
   use your laptop and copy the file across.
2. Right-click the zip, choose **Extract All…**, then open the extracted folder.
3. Open a Command Prompt in that folder: type `cmd` in Explorer's address bar and press Enter.
4. Run:

   ```bat
   install-remi.bat -PublicUrl https://apex.ny1.ninetyone.com/remi
   ```

   Say yes when Windows asks for administrator rights. The installer opens in a new window
   and keeps the address you typed.

The installer:

- copies Remi into `C:\Remi`;
- writes `C:\Remi\server.env` for the proxy:
  - `REMI_HOST=127.0.0.1`, `REMI_PORT=8765`,
    `REMI_PUBLIC_URL=https://apex.ny1.ninetyone.com/remi`;
  - no server mode, and no firewall port (it removes an old Remi rule if there is one);
- registers a startup task, so Remi runs whenever the server is on (as the low-privilege
  LOCAL SERVICE account);
- starts Remi, checks it answers, and prints the address to open.

Nothing else needs installing. The zip carries its own Python.

### 4. In APEX: check the tile and the IIS rule

**APEX already carries the tile:** a plain link to `/remi/` on its React landing page
(`frontend/src/pages/Home.jsx`). Nothing to paste.

**The IIS rule** is APEX's `docs/remi/IIS_RULE.md`. Ask for it to be applied, or check it is
there:

- `^remi/(.*)` is reverse-proxied to `http://127.0.0.1:8765/{R:1}`. This removes the `/remi`
  prefix.
- `^remi$` is a 302 redirect to `/remi/`.

Then open `https://apex.ny1.ninetyone.com/remi/` from your laptop. The first-run wizard
appears. Set up your plan as you did on the Mac.

### 5. The first update

When you next release, double-click `C:\Remi\update-remi.bat` on the server. It asks once for
the token from step 2 and saves it encrypted for your Windows account. APEX needs no change
for updates.

---

## Moving an existing install behind the proxy

If the server already runs Remi 0.2.0 in server mode (`http://<server>:8765/`), note that the
installer never rewrites an existing `server.env`. Move it by hand:

1. Update to 0.3.0 or later with `C:\Remi\update-remi.bat`.
2. Open `C:\Remi\server.env` in Notepad (as administrator) and make it say:

   ```
   REMI_HOST=127.0.0.1
   REMI_PORT=8765
   REMI_PUBLIC_URL=https://apex.ny1.ninetyone.com/remi
   ```

   Delete the `REMI_NETWORK` and `REMI_ALLOWED_HOSTS` lines, and keep `REMI_DATA_DIR` and
   `REMI_UPDATE_REPO` as they are.
3. Run `C:\Remi\restart-remi.bat`.
4. Remove the firewall rule. Either run `install-remi.bat` again from the unzipped bundle (it
   removes the rule when server mode is off), or in an administrator PowerShell run
   `Remove-NetFirewallRule -Group Remi`.

Your data stays where it is.

---

## Every update

1. **Mac:** commit your work, then run `make release VERSION=0.3.1` (the next number). Wait for
   **Actions › Release** to go green.
2. **Server:** double-click **`C:\Remi\update-remi.bat`**.

The update:

1. downloads the new release and checks it arrived intact;
2. backs up the database;
3. switches over and restarts Remi;
4. checks the new version answers.

If the new version doesn't start, it goes back to the one before by itself. Your data in
`C:\Remi\data` and your `server.env` are never replaced, and APEX needs no change.

**No internet on the server?** Download the zip on your laptop, copy it to the server, and in
an administrator Command Prompt run:

```bat
C:\Remi\update-remi.bat -Zip C:\path\to\remi-0.3.1-windows.zip
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
  server.env        settings: port, public address, data folder, update repository
  data\             remi.db, charts\, backups\  (never touched by updates)
  logs\             remi.log (Remi's own log), service.log (starts and stops)
  releases\         the current and previous versions
  current.txt       the version that runs; previous.txt, the one before
```

`server.env` settings (run `restart-remi.bat` after a change):

| Setting | Meaning |
| --- | --- |
| `REMI_HOST` | `127.0.0.1`: only IIS on this server can reach Remi |
| `REMI_PORT` | Remi's port (8765). If you change it, APEX's IIS rule must change too |
| `REMI_PUBLIC_URL` | The address people open, e.g. `https://apex.ny1.ninetyone.com/remi`. Remi serves its pages under that path and accepts changes from that address |
| `REMI_DATA_DIR` | Where the database lives |
| `REMI_UPDATE_REPO` | The GitHub repository updates come from |

---

## If something goes wrong

- **`https://apex.ny1.ninetyone.com/remi/` shows an IIS error (404 or 502).**
  1. Run `C:\Remi\status-remi.bat`. If Remi isn't answering on 127.0.0.1:8765, see *Remi
     doesn't start* below.
  2. If Remi is answering, the IIS rule is missing or wrong. Check it against APEX's
     `docs/remi/IIS_RULE.md`: `^remi/(.*)` → `http://127.0.0.1:8765/{R:1}`, with ARR's proxy
     enabled on the server.
- **The page loads but looks unstyled or blank, or links go to `https://apex.../app/...`
  without `/remi`.** `REMI_PUBLIC_URL` in `server.env` doesn't match the address you opened.
  Fix it and run `restart-remi.bat`.
- **"Invalid host header".** IIS forwarded a Host that Remi doesn't know. `REMI_PUBLIC_URL`'s
  host and `127.0.0.1` are accepted; check the first matches the address you opened.
- **Saving fails ("Changes must come from Remi's own pages").** The same mismatch: the browser's
  address must be `REMI_PUBLIC_URL`'s scheme and host (`https://apex.ny1.ninetyone.com`).
- **Windows won't run the scripts** (a message about execution policy or signed scripts). A
  company policy on PowerShell blocks them. The `.bat` files already ask for an exception;
  if the policy forbids that too, the scripts need rewriting as plain batch files.
- **Remi doesn't start.** Run `status-remi.bat`: it shows the end of `C:\Remi\logs\remi.log`.
  - "port 8765 is used by another program": pick a free `REMI_PORT` in `server.env`, and
    change APEX's IIS rule to match.
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

## Without a proxy (server mode)

ADR-0012's shape is still there for a server without IIS. `install-remi.bat` without
`-PublicUrl`:

- writes `REMI_NETWORK=1` and `REMI_HOST=0.0.0.0`;
- opens TCP 8765 in the firewall;
- makes Remi reachable at `http://<server>:8765/`, from its own name and addresses, plus
  `REMI_ALLOWED_HOSTS`.

The APEX server doesn't use it.

---

## The rules this follows

- **Pull only.** The server downloads from GitHub and never pushes. Its token is read-only and
  limited to the remi repository, so it cannot push even by mistake.
- **Nothing to install on the server.** The bundle carries its own Python and every dependency.
- **Stays local otherwise.** Remi itself makes no outbound calls. Only the update script talks
  to GitHub, and only when you run it.
- **The Ninety One fonts stay private.** The bundle includes them, so only publish releases in
  this private repository.
