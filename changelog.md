# Changelog

All notable changes to the `backend-vps` will be documented in this file.

## [Unreleased]
### Added
- Initialized Node project structure.
- Added essential dependencies (`express`, `cors`, `dotenv`, `bcrypt`, `jsonwebtoken`).
- Setup Prisma as the ORM to mimic Supabase query behavior.
- Generated `prisma/schema.prisma` with comprehensive models:
    - Added `User`, `Streams`, `Batches`, `Subjects`, `Chapters`, `Resources`, `Enrollments`, `Freebies`, `Inquiries`, `SiteContent`, `Tests`, `TestAttempts`, `Timetable`, `Announcements`, `Blogs`, `Notebooks`, `QuestionTags`, and `BookmarkTagRelations`.
- Created `server.js` and mounted all routes under the `/api` prefix.
- Created `middleware/auth.js` for hardened JWT verification.
- Migrated all core academic and utility routes:
    - `routes/auth.js`
    - `routes/freebies.js`
    - `routes/inquiries.js`
    - `routes/siteContent.js`
    - `routes/timetable.js`
    - `routes/tests.js`
    - `routes/blogs.js`
    - `routes/bookmarks.js`
- Implemented data migration engine in `scripts/import_data.js` with:
    - Topological dependency resolution.
    - Offset-based pagination for composite key handling.
    - Date/Time string parsing for PostgreSQL compatibility.
- Created `scripts/import_tests_csv.js` for importing test data from standalone CSV backups.
- Configured mail service placeholder and fallback logic for local development.

### Changed
- Updated Frontend `.env` and `.env.local` to point `VITE_API_URL` to `http://localhost:3001/api`.
- Hardened JWT handling so `JWT_SECRET` is required.
- Adjusted `/auth/refresh` to accept expired tokens and issue fresh ones after validation.
- Restricted CORS handling while preserving localhost development access.
- Updated auth and profile responses to include `subject`, `avatar`, and `subscribedBatchIds` for feature parity.
- Updated registration validation to accept `email` or `phone` identifiers.
- Redirected all frontend callers to use JSON-based local PostgreSQL storage instead of Supabase Cloud.
- Mounted VPS routes under `/api` while preserving root compatibility, and added a compatibility alias for bookmark callers that currently hit `/api/api/bookmarks`.
- Added a compatibility auth mount for `/api/api/*` so the current legacy login caller at `/api/api/auth/login` resolves correctly.
- Fixed Prisma client delegate mismatches across `users`, `bookmarks`, and `tests` routes that were still using old snake_case accessors.
- Fixed a remaining Prisma delegate mismatch in `resources` upload handling so teacher resource uploads can resolve the uploader correctly.
- Fixed bookmark deletion/update flows to verify ownership and clean related tag rows before deleting dependent records.
- Removed stale `page_data` handling from test updates because that field is not present in the current Prisma schema.
- Moved `@prisma/client` into runtime dependencies so production installs can execute route handlers that import Prisma.

### Bug Fixes
- Fixed `apiLogin` in `AuthContext.tsx` calling `${VITE_API_URL}/api/auth/login` which produced a double `/api/api/` prefix since `VITE_API_URL` already contains `/api`. Switched to `apiClient.post('/auth/login')` which correctly inherits the base URL.
- Updated `apiLogin` response handler to use `{ token, user }` shape returned by our Node backend instead of the Supabase `{ session }` shape.
- Updated `/auth/login` route in `auth.js` to accept both `email` and `identifier` fields for compatibility with both the standard login form and the `apiLogin` caller.
- **Fixed bookmark UI not loading**: `BookmarkListView.tsx`, `BookmarkModal.tsx`, and `ResultInterface.tsx` were constructing fetch URLs as `${VITE_API_URL}/api/bookmarks/...` which produced a double `/api/api/bookmarks/...` path (since `VITE_API_URL` is already `http://localhost:3001/api`). Removed the extra `/api` prefix from all 12 affected fetch calls across the three files.
- **Fixed test attempts not loading**: `GET /tests/attempts/me` was defined after `GET /tests/:id` in `routes/tests.js`, causing Express to match `attempts` as the `:id` wildcard parameter and return a 404. Moved the `/attempts/me` route to before the `/:id` wildcard route and removed the now-duplicate definition at the bottom of the file.
