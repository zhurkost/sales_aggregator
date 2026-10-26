import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { sanitizeListing } from "../lib/listing.ts";
import { categoryById, sanitizeCategoryOverrides } from "../lib/taxonomy.ts";
import {
  getPlatforms,
  safePublicationUrl,
  statusLabel,
} from "../lib/platforms.ts";
const scrypt = promisify(scryptCallback);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const clean = (v, n = 200) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const uuid = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const publicProfile = (p) => ({ id: p.id, login: p.login, name: p.name });
const cookie = (token, secure, age = 604800) =>
  `autopost_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
const summary = (r) => {
  const { photos, text, ...rest } = r;
  return { ...rest, photoCount: photos.length };
};

// Resolve legacy marketplace IDs on read. Original records remain intact until saved.
function normalizeCategory(record){
  const category=categoryById(record.listing?.taxonomyId);
  if(!category||category.id===record.listing.taxonomyId)return record;
  const platforms=getPlatforms(category.group,category.id);
  const platformId=id=>platforms.find(p=>p.canonicalId===id.replace(/-(parts|general)$/, '').replace(/^avby$/, 'av'))?.id||id;
  return {...record,listing:{...record.listing,taxonomyId:category.id,category:category.group},selected:(record.selected||[]).map(platformId),jobs:(record.jobs||[]).map(j=>({...j,platformId:platformId(j.platformId)}))};
}
export function createWorkspace(config) {
  const directory = config.DATA_DIR || "/var/lib/autopost";
  if (directory !== ":memory:")
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(
    directory === ":memory:" ? directory : directory + "/workspace.sqlite",
  );
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS ads(id TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), data TEXT NOT NULL, updated TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(profile_id,id));
 CREATE TABLE IF NOT EXISTS settings(profile_id TEXT PRIMARY KEY REFERENCES profiles(id), data TEXT NOT NULL);`);
  const attempts = new Map();
  const secure = new URL(config.PUBLIC_ORIGIN).protocol === "https:";
  const user = (req) => {
    const token = req.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)autopost_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    return token
      ? db
          .prepare(
            "SELECT p.* FROM profiles p JOIN sessions s ON s.profile_id=p.id WHERE s.token=? AND s.expires>?",
          )
          .get(hash(token), Date.now())
      : null;
  };
  const getAd = (profile, id) => {
    const row = db
      .prepare("SELECT data FROM ads WHERE profile_id=? AND id=?")
      .get(profile, id);
    return row ? normalizeCategory(JSON.parse(row.data)) : null;
  };
  function saveAd(profile, input) {
    if(input?.profileId && input.profileId!==profile)throw Object.assign(new Error("Профиль изменился. Откройте кабинет заново."),{status:403});
    if (!input || !uuid(input.id))
      throw new Error("Некорректный идентификатор карточки.");
    const old = getAd(profile, input.id);
    if (old && input.revision !== old.revision)
      throw Object.assign(
        new Error(
          "Карточка изменена в другой вкладке. Откройте её заново, чтобы сохранить актуальную версию.",
        ),
        { status: 409 },
      );
    if (
      !old &&
      db
        .prepare("SELECT count(*) as n FROM ads WHERE profile_id=?")
        .get(profile).n >= 500
    )
      throw new Error("Лимит MVP: 500 карточек на профиль.");
    input = normalizeCategory(input);
    const listing = sanitizeListing(input.listing);
    const category = categoryById(listing.taxonomyId);
    if (listing.taxonomyId && !category)
      throw new Error("Категория не найдена в справочнике.");
    if (category && category.group !== listing.category)
      throw new Error("Категория не соответствует карточке.");
    const photos = Array.isArray(input.photos) ? input.photos : [];
    if (
      photos.length > 12 ||
      photos.some(
        (p) =>
          !p ||
          !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/]+=*$/.test(
            p.dataUrl,
          ) ||
          p.dataUrl.length > 350000,
      )
    )
      throw new Error("Некорректные фотографии.");
    const platforms = getPlatforms(listing.category, listing.taxonomyId);
    const selected = [
      ...new Set(Array.isArray(input.selected) ? input.selected : []),
    ].filter((id) => platforms.some((p) => p.id === id));
    const jobs = (Array.isArray(input.jobs) ? input.jobs : [])
      .slice(0, 8)
      .filter((j) => platforms.some((p) => p.id === j.platformId))
      .map((j) => ({
        platformId: j.platformId,
        status: Object.hasOwn(statusLabel, j.status)
          ? j.status
          : "manual_required",
        message: clean(j.message, 600),
        ...(safePublicationUrl(j.platformId, j.url)
          ? { url: safePublicationUrl(j.platformId, j.url) }
          : {}),
        filledFields: Math.max(0, Math.min(50, Number(j.filledFields) || 0)),
        photosTransferred: Math.max(
          0,
          Math.min(12, Number(j.photosTransferred) || 0),
        ),
        ...(Number.isInteger(j.tabId) ? { tabId: j.tabId } : {}),
      }));
    const now = new Date().toISOString();
    const events = old?.events || [];
    const message = !old
      ? "Карточка создана"
      : input.archived && !old.archived
        ? "Убрано в архив Автопоста"
        : !input.archived && old.archived
          ? "Восстановлено из архива"
          : JSON.stringify(jobs) !== JSON.stringify(old.jobs)
            ? "Обновлены задания на площадках"
            : "Карточка обновлена";
    if (!events.length || events.at(-1).message !== message)
      events.push({ at: now, message });
    const record = {
      id: input.id,
      revision: (old?.revision || 0) + 1,
      createdAt: old?.createdAt || now,
      updatedAt: now,
      text: clean(input.text, 8000),
      listing,
      photos: photos.map((p) => ({
        id: clean(p.id, 80) || randomUUID(),
        name: clean(p.name, 160),
        type: p.dataUrl.slice(5, p.dataUrl.indexOf(";")),
        dataUrl: p.dataUrl,
      })),
      selected,
      prepared: input.prepared === true,
      categoryConfirmed: !!category && input.categoryConfirmed === true,
      categoryOverrides: sanitizeCategoryOverrides(input.categoryOverrides),
      archived: input.archived === true,
      jobs,
      batchId: uuid(input.batchId) ? input.batchId : "",
      externalId: clean(input.externalId, 120),
      photoRefs: Array.isArray(input.photoRefs)
        ? input.photoRefs
            .slice(0, 12)
            .map((v) => clean(v, 2000))
            .filter(Boolean)
        : [],
      events: events.slice(-100),
    };
    db.prepare(
      "INSERT INTO ads(profile_id,id,data,updated,summary) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,id) DO UPDATE SET data=excluded.data,updated=excluded.updated,summary=excluded.summary",
    ).run(
      profile,
      input.id,
      JSON.stringify(record),
      now,
      JSON.stringify(summary(record)),
    );
    return record;
  }
  async function body(req) {
    if (!req.headers.get("content-type")?.includes("application/json"))
      throw new Error("Нужен JSON.");
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Пустой запрос.");
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        throw Object.assign(new Error("Слишком большой запрос."), {
          status: 413,
        });
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function handle(req) {
    const path = new URL(req.url).pathname;
    const reply = (data, status = 200, headers = {}) =>
      Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store", ...headers },
      });
    if (!path.startsWith("/api/workspace/")) return null;
    if (
      req.method !== "GET" &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      return reply(
        { error: "Запрос разрешён только со страницы Автопост." },
        403,
      );
    try {
      db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      if (path === "/api/workspace/session" && req.method === "GET") {
        const p = user(req);
        return reply({
          profile: p ? publicProfile(p) : null,
          profiles: db
            .prepare("SELECT id,login,name FROM profiles ORDER BY login")
            .all(),
        });
      }
      if (path === "/api/workspace/logout" && req.method === "POST") {
        const token = req.headers
          .get("cookie")
          ?.match(/autopost_session=([a-f0-9]{64})/)?.[1];
        if (token)
          db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
        return reply({ ok: true }, 200, {
          "Set-Cookie": cookie("", secure, 0),
        });
      }
      if (
        ["/api/workspace/login", "/api/workspace/register"].includes(path) &&
        req.method === "POST"
      ) {
        const input = await body(req);
        const login = clean(input.login, 40).toLowerCase(),
          password = input.password;
        if (
          !/^[\p{L}\p{N}_.-]{2,40}$/u.test(login) ||
          typeof password !== "string" ||
          password.length < 6 ||
          password.length > 128
        )
          throw new Error("Логин: 2–40 букв или цифр. Пароль: 6–128 символов.");
        const now = Date.now();
        for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
        const bucket = attempts.get(login) || { n: 0, until: now + 600000 };
        if (bucket.n >= 10 || attempts.size > 1000)
          return reply(
            { error: "Слишком много попыток. Подождите 10 минут." },
            429,
          );
        bucket.n++;
        attempts.set(login, bucket);
        let p = db.prepare("SELECT * FROM profiles WHERE login=?").get(login);
        if (path.endsWith("/register")) {
          if (p)
            throw new Error(
              "Такой логин уже есть. Выберите профиль и войдите.",
            );
          if (db.prepare("SELECT count(*) as n FROM profiles").get().n >= 100)
            throw new Error("Лимит профилей MVP достигнут.");
          const salt = randomBytes(16).toString("hex");
          const derived = await scrypt(password, salt, 64);
          const id = randomUUID();
          try {
            db.prepare("INSERT INTO profiles VALUES(?,?,?,?,?)").run(
              id,
              login,
              clean(input.name, 80) || login,
              salt,
              derived.toString("hex"),
            );
          } catch {
            throw new Error("Такой логин уже есть.");
          }
          p = db.prepare("SELECT * FROM profiles WHERE id=?").get(id);
        } else {
          const derived = await scrypt(
            password,
            p?.salt || "dummy-account-salt",
            64,
          );
          if (!p || !timingSafeEqual(derived, Buffer.from(p.password, "hex")))
            throw Object.assign(new Error("Неверный логин или пароль."), {
              status: 401,
            });
        }
        attempts.delete(login);
        const token = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          hash(token),
          p.id,
          Date.now() + 604800000,
        );
        return reply({ profile: publicProfile(p) }, 200, {
          "Set-Cookie": cookie(token, secure),
        });
      }
      const p = user(req);
      if (!p) return reply({ error: "Выберите профиль и войдите." }, 401);
      if (path === "/api/workspace/ads" && req.method === "GET") {
        const records = db
          .prepare(
            "SELECT summary FROM ads WHERE profile_id=? ORDER BY updated DESC",
          )
          .all(p.id)
          .map((row) => normalizeCategory(JSON.parse(row.summary)));
        return reply({ ads: records });
      }
      if (path === "/api/workspace/ads" && req.method === "POST")
        return reply({ ad: saveAd(p.id, await body(req)) });
      const match = path.match(
        /^\/api\/workspace\/ads\/([a-zA-Z0-9_-]{1,80})$/,
      );
      if (match && req.method === "GET") {
        const ad = getAd(p.id, match[1]);
        return ad
          ? reply({ ad })
          : reply({ error: "Объявление не найдено." }, 404);
      }
      if (path === "/api/workspace/settings" && req.method === "GET") {
        const row = db
          .prepare("SELECT data FROM settings WHERE profile_id=?")
          .get(p.id);
        return reply({ settings: row ? JSON.parse(row.data) : {} });
      }
      if (path === "/api/workspace/settings" && req.method === "POST") {
        const input = await body(req);
        const settings = {
          company: clean(input.company, 150),
          contactPerson: clean(input.contactPerson, 100),
          phone: clean(input.phone, 40),
          city: clean(input.city, 100),
          integrations: {},
        };
        for (const platform of ["kufar", "bamper", "flagma"])
          settings.integrations[platform] = {
            enabled: input.integrations?.[platform]?.enabled === true,
            notes: clean(input.integrations?.[platform]?.notes, 400),
          };
        db.prepare(
          "INSERT INTO settings VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET data=excluded.data",
        ).run(p.id, JSON.stringify(settings));
        return reply({ settings });
      }
      return reply({ error: "Не найдено." }, 404);
    } catch (e) {
      return reply(
        {
          error:
            e instanceof SyntaxError
              ? "Некорректный JSON."
              : e.message || "Не удалось сохранить.",
        },
        e.status || 400,
      );
    }
  }
  return { handle, user, close: () => db.close() };
}
