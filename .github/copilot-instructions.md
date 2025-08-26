# Simply Task Manager

Simply is a dark-mode task manager web application built with Node.js, Express, SQLite (better-sqlite3), and vanilla JavaScript. It features task creation, real-time time tracking, updates system, and task status management (open/waiting/closed).

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

Bootstrap, build, and run the repository:
- `npm install` -- takes ~10 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- `npm start` -- runs production server on port 3000. Starts instantly.
- `npm run dev` -- runs server with nodemon for development (auto-restart on file changes).

The application requires no build step and runs directly from source files.

## Validation

- ALWAYS manually test the web application after making changes by navigating to http://localhost:3000
- ALWAYS run through complete end-to-end scenarios after making changes:
  1. Create a new task (click + button, enter task title)
  2. Add an update to the task (type in "Write an update..." textarea, click Send)
  3. Start time tracking (click Time button, verify it changes to Stop)
  4. Stop time tracking (click Stop button, verify time entry is created)
  5. Test task status changes (Waiting, Close buttons)
  6. Test filtering (Open, Waiting, Closed tabs in sidebar)
- The application stores data in SQLite database (`data/taskmanager.db`) which is auto-created
- No tests exist in this repository - manual validation is required
- No linting or formatting tools are configured

## Repository Structure

```
/
├── server.js              # Express server with SQLite backend and API routes
├── package.json           # Dependencies: express, better-sqlite3, nodemon
├── public/
│   ├── index.html        # Single-page application HTML
│   ├── app.js            # Frontend JavaScript (task management, time tracking)
│   └── style.css         # GitHub-inspired dark theme styling
└── data/                 # SQLite database directory (auto-created)
    └── taskmanager.db    # Main database file
```

## Key Components

### Backend (server.js)
- Express server with JSON middleware
- SQLite database with automatic schema migration
- REST API endpoints:
  - `GET/POST /api/tasks` - Task CRUD operations
  - `GET/POST /api/tasks/:id/updates` - Task updates
  - `POST/DELETE /api/time_entries` - Time tracking
  - `PATCH /api/tasks/:id/status` - Task status changes
- Database tables: tasks, updates, time_entries

### Frontend (public/)
- Vanilla JavaScript (no frameworks)
- Real-time time tracking with live duration updates
- Task filtering and status management
- Responsive dark-mode UI with GitHub-inspired styling
- Auto-expanding textareas and keyboard shortcuts

## Development Workflow

1. Install dependencies: `npm install`
2. Start development server: `npm run dev` (auto-restart on changes)
3. Open browser to http://localhost:3000
4. Make changes to files in `public/` or `server.js`
5. Test changes manually in browser
6. For backend changes, server restarts automatically with nodemon

## Common Tasks

The following are frequently accessed files and their purposes:

### server.js
- Main backend file containing all API routes
- Database schema and migration logic
- Express server configuration
- Modify this file for: new API endpoints, database changes, server configuration

### public/app.js  
- All frontend JavaScript logic
- Event handlers for UI interactions
- Time tracking and live updates
- API communication functions
- Modify this file for: UI behavior, time tracking features, task management logic

### public/style.css
- Complete application styling
- GitHub-inspired dark theme CSS variables
- Responsive layout and component styles  
- Modify this file for: visual changes, layout adjustments, theming

### public/index.html
- Single HTML file for the entire application
- Contains all DOM structure
- Rarely needs modification unless adding new UI elements

## Database Information

- SQLite database auto-created in `data/taskmanager.db`
- No manual setup required - schema created automatically
- Migration system handles adding new columns
- Tables: tasks (id, title, created_at, closed_at, waiting_since), updates (id, task_id, content, created_at), time_entries (id, task_id, start_at, end_at, duration_seconds)

## Common Issues and Solutions

- **Port already in use**: Kill existing process or change PORT environment variable
- **Database locked**: Stop all running server instances
- **Changes not reflecting**: Ensure nodemon is running (`npm run dev`) or restart server
- **Time tracking issues**: Check browser console for JavaScript errors

## Testing Strategy

Since no automated tests exist, always follow this manual testing checklist:
1. Can create new tasks
2. Can add updates to tasks  
3. Can start/stop time tracking
4. Can change task status (waiting/closed)
5. Can filter tasks by status
6. Time tracking displays correctly and updates live
7. All buttons and interactions work without console errors

Navigate to http://localhost:3000 and verify all functionality works as expected.