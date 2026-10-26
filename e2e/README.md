# Browser end-to-end smoke test

Drives a real Chromium through the public site and every admin area against a running stack
(frontend → API → PostgreSQL) and fails on any console error.

```bash
pip install playwright && playwright install chromium     # once
# in backend/: npm run db:reset -- --yes && npm run db:seed && npm run dev
# in frontend/: npm run dev
python3 e2e/smoke.py                      # BASE_URL=http://localhost:5173 by default
```

It expects a **freshly seeded** database (it asserts the seeded prototype content and uses the demo accounts), so run it
against a throw-away development database, never against real data. Screenshots land in `$SHOTS_DIR`
(default `<tmp>/maliren-shots`).
