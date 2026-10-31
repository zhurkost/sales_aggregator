# Angular and Spring Boot migration

The active application is an Angular 21 standalone frontend (`frontend/`) and a Spring Boot 3.5 / Java 17 API (`backend/`). The Russian seller workspace, category catalogue, SQLite records, HTTP endpoints, cookies and browser-extension protocol are retained. Shared browser/domain utilities remain in `lib/`; the backend executes Java, with no Node process or JavaScript interpreter.

## Run locally

Requirements: Node.js 22.12+ or 24, npm 11+, and a JDK 17+ (`JAVA_HOME` if it is not on PATH). The checked-in Maven wrapper downloads Maven 3.9.11.

```sh
npm ci
npm --prefix frontend ci
npm run dev
```

Open `http://127.0.0.1:5173`. This is the same origin already permitted by the browser extension. The API listens on `127.0.0.1:3000`; Angular proxies `/api`. The development runner reads optional AI configuration from `.dev.vars`. Keep keys out of Git. Existing development data stays in `work/local-data/workspace.sqlite`.

The two services can also run separately:

```sh
node scripts/maven.mjs spring-boot:run
npm --prefix frontend start
```

When launched separately, set `DATA_DIR` to an absolute directory if sharing an existing development database. The API otherwise uses `backend/work/local-data`.

## Verify and build

```sh
npm test
npm run test:frontend
npm run test:backend
npm run build
npm run package:vps
```

The frontend compiles with Angular strict template/type checking. Backend tests exercise the legacy password/session format, account and team isolation, stale revisions, atomic batch edits, history, idempotent import, and publication reservations. Generated domain fixtures compare Java extension recipes and attributes against the original TypeScript implementation for every category. Regenerate snapshots after changing shared domain rules:

```sh
node scripts/export-java-domain.mjs
node scripts/export-domain-fixtures.mjs
```

Release output: `work/autopost-angular-spring.tar.gz`, containing the executable JAR, Angular assets, deployment configuration and SQLite backup helper. It contains no keys or database files.

## VPS deployment

The destination is still `https://87.199.205.227`. Deployment is a separate action; pushing this branch does not update the VPS. Install a Java 17+ runtime at `/usr/bin/java` before switching. Allow for the new service's 640 MB memory ceiling and confirm the VPS has headroom. nginx, HTTP Basic Auth, certificate renewal and the existing secret files remain in use.

Upload the archive and `deploy/spring/deploy-release.sh` through the owner's SSH/SFTP access, then run as root:

```sh
bash /root/autopost-deploy/deploy-release.sh /root/autopost-deploy/release.tar.gz
```

The script backs up SQLite, stages a new release, saves the previous systemd/nginx configuration, switches the application and checks `/healthz`. A failed startup or nginx configuration check restores the previous release and configuration. Production requires a matching `PUBLIC_ORIGIN=https://87.199.205.227` and the existing `VPS_PROXY_SECRET`; the API rejects an empty/short production proxy secret.

`/var/lib/autopost/workspace.sqlite` and all table/JSON formats are preserved. Existing profiles use Node-compatible scrypt parameters; existing session hashes and expiry timestamps remain valid. Do not run the old and new APIs against the live database concurrently during cutover. Rehearse against a backup first. Rollback requires restoring both the release symlink and the saved systemd/nginx files because the old API uses Node and the new one uses Java.

## Legacy sources

The React/Sites sources and Node API remain available for comparison and rollback; they are not part of the Angular/Spring runtime or release archive. `npm run dev:legacy`, `npm run build:legacy` and the existing `vps/` guide refer to that previous implementation. `npm run dev`, `build`, and `package:vps` target the migrated application.

Live marketplace submission and paid AI calls are not run by automated tests. Those depend on the owner's accounts and configured provider keys. The extension still requires manual login/CAPTCHA and explicit user confirmation where a marketplace requires it.

## Migration validation

Validated locally on 31 October 2026: 144 existing tests, 5 Angular workspace tests, and 8 Java tests, including comparisons across all 315 catalogue categories. The production Angular bundle was exercised in Chrome against the Spring API with the production CSP: registration, saving/reopening a listing, every workspace navigation section, and a 390 px mobile layout. The browser check found and resolved Angular's asynchronous change-detection and critical-CSS loading compatibility issues. The live VPS was not changed.
