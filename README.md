# Simply Task Manager

A dark-mode task manager web application built with Node.js, Express, SQLite (better-sqlite3), and vanilla JavaScript.

## Features
- Create tasks & add updates
- Real-time time tracking (start/stop)
- Task status management (open / waiting / closed)
- Sidebar filtering by status
- GitHub-inspired dark theme

## Quick Start
```bash
npm install
npm run dev   # development (nodemon)
npm start     # production mode
```
Visit: http://localhost:3000

## Manual Testing Checklist
1. Create a new task (+ button)
2. Add an update
3. Start time tracking (Time -> Stop)
4. Stop time tracking (entry appears)
5. Change status (Waiting / Close)
6. Filter via Open / Waiting / Closed tabs
7. Confirm no console errors

## Autostart on macOS Using launchd
You can have `npm run dev` start automatically at login via a LaunchAgent and the included helper script.

### 1. Versioned Helper Script
Already in repo: `scripts/simply-dev.sh`

Make sure it is executable:
```bash
chmod +x scripts/simply-dev.sh
```
The script: 
- Sets a predictable PATH (`/usr/local/bin:/opt/homebrew/bin:...`)
- Installs dependencies if `node_modules` is missing
- Executes `npm run dev` in the repository root

### 2. LaunchAgent Plist (Versioned)
Repo file: `launchd/com.steffen.simply.dev.plist`

This plist references the script via:
```
/bin/zsh -c $HOME/GitHub/steffen/simply/scripts/simply-dev.sh
```
It logs output to `~/Library/Logs/simply-dev.out.log` and errors to `~/Library/Logs/simply-dev.err.log`.

### 3. Symlink Plist Into LaunchAgents
From repo root:
```bash
rm -f ~/Library/LaunchAgents/com.steffen.simply.dev.plist
ln -s "$PWD/launchd/com.steffen.simply.dev.plist" \
      ~/Library/LaunchAgents/com.steffen.simply.dev.plist
```

### 4. Load (or Reload) the Agent
```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.steffen.simply.dev.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.steffen.simply.dev.plist
```
Older syntax (macOS < 10.13):
```bash
launchctl unload  ~/Library/LaunchAgents/com.steffen.simply.dev.plist
launchctl load    ~/Library/LaunchAgents/com.steffen.simply.dev.plist
```

### 5. Verify
```bash
launchctl list | grep com.steffen.simply.dev
tail -n 40 ~/Library/Logs/simply-dev.out.log
```
Browse to http://localhost:3000

### 6. Manual Test Without launchd
```bash
scripts/simply-dev.sh   # Ctrl+C to stop
```

### 7. Unload / Disable
```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.steffen.simply.dev.plist
```

### 8. Cleanup (Remove Autostart)
```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.steffen.simply.dev.plist 2>/dev/null || true
rm ~/Library/LaunchAgents/com.steffen.simply.dev.plist
rm -f ~/Library/Logs/simply-dev.out.log ~/Library/Logs/simply-dev.err.log
```

### Troubleshooting
- "node: command not found": Ensure `/usr/local/bin` or `/opt/homebrew/bin` in both script PATH and plist PATH.
- No log files: Plist may not have loaded—check: `log show --last 5m | grep com.steffen.simply.dev`
- Multiple instances: Only one plist with label `com.steffen.simply.dev` should exist in `~/Library/LaunchAgents`.

### Production Variant
To run production mode instead, either:
1. Edit `scripts/simply-dev.sh` last line to `exec "$NPM_BIN" start`
2. Or copy it:
```bash
cp scripts/simply-dev.sh scripts/simply-start.sh
sed -i '' 's/run dev/start/' scripts/simply-start.sh
```
Then duplicate the plist with a new Label (e.g. `com.steffen.simply.start`).

## Project Structure
```
server.js
public/
  index.html
  app.js
  style.css
scripts/
  simply-dev.sh
launchd/
  com.steffen.simply.dev.plist
```

## License
(Add license information here if desired.)
