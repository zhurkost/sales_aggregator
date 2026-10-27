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
import { sanitizeListing,fields,partFields,listingTitle } from "../lib/listing.ts";
import { categoryById, sanitizeCategoryOverrides } from "../lib/taxonomy.ts";
import {cleanAttributes,descriptionWithAttributes} from "../lib/attributes.ts";
import {extensionRecipe} from "../lib/extension-config.ts";
import {fetchFeed} from './feed.mjs';
import {editListing} from '../lib/batch-edit.ts';
import {cleanTemplates} from '../lib/seller-template.ts';
import {
  getPlatforms,
  safePublicationUrl,
  statusLabel,
  cleanRemoteStatus,
} from "../lib/platforms.ts";
const scrypt = promisify(scryptCallback);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const clean = (v, n = 200) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const uuid = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const sameMap=(a,b)=>JSON.stringify(Object.entries(a||{}).sort())===JSON.stringify(Object.entries(b||{}).sort());
const publicProfile = (p) => ({ id: p.workspaceId||p.id, accountId:p.id, login: p.login, name: p.workspaceName||p.name });
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
  db.exec(`CREATE TABLE IF NOT EXISTS launches(profile_id TEXT NOT NULL,record_id TEXT NOT NULL,platform_id TEXT NOT NULL,batch_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(profile_id,record_id,platform_id));`);
  db.exec(`CREATE TABLE IF NOT EXISTS versions(profile_id TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(profile_id,record_id,version));`);
  db.exec(`CREATE TABLE IF NOT EXISTS members(owner_id TEXT NOT NULL REFERENCES profiles(id),member_id TEXT NOT NULL REFERENCES profiles(id),PRIMARY KEY(owner_id,member_id));`);
  db.exec(`CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL,record_id TEXT NOT NULL,platform_id TEXT NOT NULL,message TEXT NOT NULL,created TEXT NOT NULL,seen INTEGER NOT NULL DEFAULT 0);`);
  if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='workspace_id'))db.exec("ALTER TABLE sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''");
  const attempts = new Map();
  const feedRequests=new Map();
  const secure = new URL(config.PUBLIC_ORIGIN).protocol === "https:";
  const user = (req) => {
    const token = req.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)autopost_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const actor=token
      ? db
          .prepare(
            "SELECT p.*,s.workspace_id FROM profiles p JOIN sessions s ON s.profile_id=p.id WHERE s.token=? AND s.expires>?",
          )
          .get(hash(token), Date.now())
      : null;
    if(!actor)return null;
    const chosen=actor.workspace_id;
    const allowed=chosen && (chosen===actor.id || db.prepare('SELECT 1 FROM members WHERE owner_id=? AND member_id=?').get(chosen,actor.id));
    actor.workspaceId=allowed?chosen:actor.id;
    actor.workspaceName=db.prepare('SELECT name FROM profiles WHERE id=?').get(actor.workspaceId)?.name||actor.name;
    return actor;
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
    if(old?.jobs.length && listing.taxonomyId!==old.listing.taxonomyId)throw new Error('У карточки уже есть задания. Для другой категории создайте отдельную карточку.');
    const categoryOverrides=sanitizeCategoryOverrides(input.categoryOverrides);
    const attributes=cleanAttributes(listing,input.attributes,categoryOverrides);
    const platformText=Object.fromEntries(['kufar','onliner','bamper','av','abw','flagma','drom'].map(id=>[id,clean(input.platformText?.[id],1000)]).filter(([,v])=>v));
    const content=r=>JSON.stringify([r.listing,r.attributes||{},r.categoryOverrides||{},r.platformText||{},(r.photos||[]).map(p=>[p.id,p.dataUrl])]);
    const changed=!old||content(old)!==content({listing,attributes,categoryOverrides,platformText,photos});
    const contentVersion=(old?.contentVersion||1)+(old&&changed?1:0);
    const selected = [
      ...new Set(Array.isArray(input.selected) ? input.selected : []),
    ].filter((id) => platforms.some((p) => p.id === id));
    const requestedJobs=Array.isArray(input.jobs)?input.jobs:[];
    for(const previous of old?.jobs||[]) {
      const next=requestedJobs.find(j=>j.platformId===previous.platformId);
      if(!next){requestedJobs.push(previous);continue;}
      if((previous.batchId||old.batchId) && (next.batchId||input.batchId)!==(previous.batchId||old.batchId) && (previous.url||!['draft','ready','cancelled','unsupported'].includes(previous.status)))
        throw Object.assign(new Error('У площадки уже есть задание. Обновите карточку и продолжите его.'),{status:409});
      if(previous.url && !next.url)next.url=previous.url;
    }
    const jobs = requestedJobs.filter((j,i,all)=>all.findIndex(other=>other.platformId===j.platformId)===i)
      .slice(0, 8)
      .filter((j) => platforms.some((p) => p.id === j.platformId))
      .map((j) => ({
        ...(uuid(j.batchId)?{batchId:j.batchId}:{}),
        sentVersion: old?.jobs.find(prev=>prev.platformId===j.platformId)?.sentVersion || (['opening','ready','queued'].includes(j.status)?contentVersion:0),
        platformId: j.platformId,
        status: Object.hasOwn(statusLabel, j.status)
          ? j.status
          : "manual_required",
        message: clean(j.message, 600),
        ...(safePublicationUrl(j.platformId,j.url) && cleanRemoteStatus(j.remoteStatus) ? {remoteStatus:cleanRemoteStatus(j.remoteStatus)} : {}),
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
    const changes=old?Object.keys(listing).filter(k=>listing[k]!==old.listing[k]):[];
    const labels={title:'название',description:'описание',category:'товарная группа',taxonomyId:'категория',...Object.fromEntries([...fields,...partFields].map(f=>[f.key,f.label.replace(/ · .*/, '').toLowerCase()]))};
    const detail=old&&old.sold!==(input.sold===true)?(input.sold?'Товар отмечен проданным':'Товар возвращён в продажу'):old&&old.assigneeId!==input.assigneeId&&input.assigneeId?'Назначен ответственный':changes.length?'Изменены поля: '+changes.map(k=>labels[k]||k).join(', '):message;
    if(changed || !events.length || events.at(-1).message !== detail)
      events.push({ at: now, message:detail, actor:input._actor||profile });
    const record = {
      id: input.id,
      revision: (old?.revision || 0) + 1,
      contentVersion,
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
      attributes: cleanAttributes(listing,input.attributes,sanitizeCategoryOverrides(input.categoryOverrides)),
      archived: input.archived === true,
      sold: input.sold===true,
      assigneeId: (input.assigneeId===profile || db.prepare('SELECT 1 FROM members WHERE owner_id=? AND member_id=?').get(profile,clean(input.assigneeId,80)))?input.assigneeId:'',
      jobs,
      batchId: uuid(input.batchId) ? input.batchId : "",
      externalId: clean(input.externalId, 120),
      sourceId: clean(input.sourceId,80),
      platformText,
      photoRefs: Array.isArray(input.photoRefs)
        ? input.photoRefs
            .slice(0, 12)
            .map((v) => clean(v, 2000))
            .filter(Boolean)
        : [],
      events: events.slice(-100),
    };
    if(changed && old) {
      db.prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?)').run(profile,old.id,old.contentVersion||1,JSON.stringify({listing:old.listing,attributes:old.attributes||{},categoryOverrides:old.categoryOverrides||{},platformText:old.platformText||{},text:old.text}),now);
      db.prepare('DELETE FROM versions WHERE profile_id=? AND record_id=? AND version NOT IN (SELECT version FROM versions WHERE profile_id=? AND record_id=? ORDER BY version DESC LIMIT 20)').run(profile,old.id,profile,old.id);
    }
    db.prepare(
      "INSERT INTO ads(profile_id,id,data,updated,summary) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,id) DO UPDATE SET data=excluded.data,updated=excluded.updated,summary=excluded.summary",
    ).run(
      profile,
      input.id,
      JSON.stringify(record),
      now,
      JSON.stringify(summary(record)),
    );
    const exception=j=>j.remoteStatus&&['rejected','action_required'].includes(j.remoteStatus.state)?[j.remoteStatus.state,j.remoteStatus.message]:['error','authorization_required','captcha_required','category_required'].includes(j.status)?[j.status,j.message]:null;
    for(const job of jobs){const next=exception(job),previous=old?.jobs.find(j=>j.platformId===job.platformId);
      if(next && JSON.stringify(next)!==JSON.stringify(previous?exception(previous):null))
        db.prepare('INSERT INTO notifications(profile_id,record_id,platform_id,message,created) VALUES(?,?,?,?,?)').run(profile,record.id,job.platformId,`${listing.title||listing.partName||'Карточка'}: ${next[1]}`,now);
    }
    db.prepare('DELETE FROM notifications WHERE profile_id=? AND id NOT IN (SELECT id FROM notifications WHERE profile_id=? ORDER BY id DESC LIMIT 200)').run(profile,profile);
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
        db.prepare("INSERT INTO sessions(token,profile_id,expires) VALUES(?,?,?)").run(
          hash(token),
          p.id,
          Date.now() + 604800000,
        );
        return reply({ profile: publicProfile(p) }, 200, {
          "Set-Cookie": cookie(token, secure),
        });
      }
      const actor = user(req);
      if (!actor) return reply({ error: "Выберите профиль и войдите." }, 401);
      const p={...actor,id:actor.workspaceId};
      if(req.headers.get('x-autopost-workspace') && req.headers.get('x-autopost-workspace')!==p.id)
        return reply({error:'Кабинет изменился в другой вкладке. Обновите страницу.'},409);
      if(path==='/api/workspace/notifications') {
        if(req.method==='POST') {
          const input=await body(req);
          if(!Array.isArray(input.ids)||input.ids.length>200)throw new Error('Некорректные уведомления.');
          for(const id of input.ids)if(Number.isSafeInteger(id))db.prepare('UPDATE notifications SET seen=1 WHERE profile_id=? AND id=?').run(p.id,id);
        }
        return reply({notifications:db.prepare('SELECT id,record_id AS recordId,platform_id AS platformId,message,created,seen FROM notifications WHERE profile_id=? ORDER BY id DESC').all(p.id)});
      }
      if(path==='/api/workspace/team') {
        if(req.method==='POST') {
          const input=await body(req);
          if(input.action==='switch') {
            const owner=clean(input.workspaceId,80);
            if(owner!==actor.id && !db.prepare('SELECT 1 FROM members WHERE owner_id=? AND member_id=?').get(owner,actor.id))return reply({error:'Нет доступа к кабинету.'},403);
            const token=req.headers.get('cookie')?.match(/autopost_session=([a-f0-9]{64})/)?.[1];
            db.prepare('UPDATE sessions SET workspace_id=? WHERE token=?').run(owner,hash(token));return reply({ok:true});
          }
          if(p.id!==actor.id)return reply({error:'Управлять участниками может только владелец кабинета.'},403);
          if(input.action==='add') {
            const member=db.prepare('SELECT id FROM profiles WHERE login=?').get(clean(input.login,40).toLowerCase());
            if(!member)throw new Error('Пользователь должен сначала создать профиль. Укажите его точный логин.');
            if(member.id===actor.id)throw new Error('Вы уже владелец кабинета.');
            if(db.prepare('SELECT count(*) AS n FROM members WHERE owner_id=?').get(actor.id).n>=20)throw new Error('До 20 участников на кабинет.');
            db.prepare('INSERT OR IGNORE INTO members VALUES(?,?)').run(actor.id,member.id);
          }else if(input.action==='remove')db.prepare('DELETE FROM members WHERE owner_id=? AND member_id=?').run(actor.id,clean(input.memberId,80));
          else throw new Error('Неизвестное действие.');
        }
        const owner=db.prepare('SELECT id,name,login FROM profiles WHERE id=?').get(p.id);
        const members=db.prepare('SELECT p.id,p.name,p.login FROM profiles p JOIN members m ON m.member_id=p.id WHERE m.owner_id=?').all(p.id);
        const workspaces=db.prepare('SELECT id,name FROM profiles WHERE id=? OR id IN(SELECT owner_id FROM members WHERE member_id=?)').all(actor.id,actor.id);
        return reply({role:p.id===actor.id?'owner':'manager',accountId:actor.id,workspaceId:p.id,workspaces,members:[{...owner,role:'owner'},...members.map(m=>({...m,role:'manager'}))]});
      }
      if(path==='/api/workspace/batch-edit' && req.method==='POST') {
        const input=await body(req);
        if(!Array.isArray(input.items)||!input.items.length||input.items.length>100||new Set(input.items.map(i=>i.id)).size!==input.items.length)throw new Error('Выберите от 1 до 100 разных карточек.');
        db.exec('BEGIN IMMEDIATE');
        try{
          const ads=input.items.map(item=>{
            const old=getAd(p.id,item.id);
            if(!old||old.revision!==item.revision)throw Object.assign(new Error('Одна из карточек изменилась. Обновите предпросмотр.'),{status:409});
            return saveAd(p.id,{...old,listing:editListing(old.listing,input.edit),_actor:p.name});
          });
          db.exec('COMMIT');return reply({ads:ads.map(summary)});
        }catch(error){db.exec('ROLLBACK');throw error;}
      }
      const versionsMatch=path.match(/^\/api\/workspace\/ads\/([a-zA-Z0-9_-]{1,80})\/versions$/);
      if(versionsMatch&&req.method==='GET')return reply({versions:db.prepare('SELECT version,created,data FROM versions WHERE profile_id=? AND record_id=? ORDER BY version DESC').all(p.id,versionsMatch[1]).map(v=>({...v,data:JSON.parse(v.data)}))});
      if(versionsMatch&&req.method==='POST') {
        const input=await body(req),old=getAd(p.id,versionsMatch[1]);
        const snapshot=db.prepare('SELECT data FROM versions WHERE profile_id=? AND record_id=? AND version=?').get(p.id,versionsMatch[1],Number(input.version));
        if(!old||!snapshot)throw new Error('Версия не найдена.');
        if(old.revision!==input.revision)throw Object.assign(new Error('Карточка изменилась. Обновите историю.'),{status:409});
        return reply({ad:saveAd(p.id,{...old,...JSON.parse(snapshot.data),_actor:p.name})});
      }
      if(path==='/api/workspace/feed' && req.method==='POST') {
        const input=await body(req);
        if(Date.now()-(feedRequests.get(p.id)||0)<15000) return reply({error:'Повторите загрузку через 15 секунд.'},429);
        feedRequests.set(p.id,Date.now());
        return reply({text:await fetchFeed(clean(input.url,2000))});
      }
      if(path==='/api/workspace/import' && req.method==='POST') {
        const input=await body(req), sourceId=clean(input.sourceId,80), incoming=input.record;
        if(!sourceId || !incoming || !Array.isArray(input.fields))throw new Error('Выберите источник и сопоставьте колонки.');
        const externalId=clean(incoming.externalId,120);
        const candidates=db.prepare('SELECT data FROM ads WHERE profile_id=?').all(p.id).map(row=>JSON.parse(row.data));
        const match=candidates.filter(ad=>ad.sourceId===sourceId && externalId && ad.externalId===externalId);
        if(match.length>1)throw new Error('В кабинете несколько карточек с одним ID. Устраните дубли перед обновлением.');
        const old=match[0];
        if(old && input.expectedRevision!==old.revision)throw Object.assign(new Error('Карточка изменилась после предпросмотра. Обновите список и повторите импорт.'),{status:409});
        if(old?.archived || old?.sold)throw new Error('Карточка с этим ID в архиве или продана. Восстановите её явно перед импортом.');
        let record={...incoming,id:'import-'+hash(sourceId+'\0'+(externalId||JSON.stringify(incoming.listing))).slice(0,40),sourceId};
        if(old) {
          if(input.fields.includes('currency') && !incoming.listing?.currency)throw new Error('В выгрузке неподдерживаемая валюта. Используйте BYN, USD или EUR.');
          if(input.fields.includes('currency') && incoming.listing.currency!==old.listing.currency && (!input.fields.includes('price')||!incoming.listing.price))throw new Error('При смене валюты укажите новую цену в той же строке. Пересчёт автоматически не выполняется.');
          const listing={...old.listing};
          for(const field of input.fields) if(Object.hasOwn(listing,field) && !['category','taxonomyId'].includes(field) && incoming.listing?.[field])listing[field]=incoming.listing[field];
          record={...old,listing,text:listing.description,photos:incoming.photos?.length?incoming.photos:old.photos,
            photoRefs:input.fields.includes('photoUrls') && incoming.photoRefs?.length?incoming.photoRefs:old.photoRefs};
        } else if(!externalId) {
          // Exact reimports are idempotent even without a source ID for the item.
          const same=getAd(p.id,record.id);if(same)return reply({ad:same,action:'unchanged'});
        }
        return reply({ad:saveAd(p.id,{...record,_actor:p.name}),action:old?'updated':'created'});
      }
      if (path === "/api/workspace/extension-config" && req.method === "POST") {
        const input = await body(req);
        if (input.profileId && input.profileId !== p.id) return reply({error:"Профиль изменился. Откройте кабинет заново."},403);
        if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20)
          throw new Error("Нужно от 1 до 20 карточек.");
        const recipes=input.items.map(extensionRecipe);
        if(input.items.some(item=>item.recordId && getAd(p.id,item.recordId)?.sold))throw new Error('Товар отмечен проданным. Подача остановлена.');
        if(input.reserve===true || input.verify===true) {
          db.exec('BEGIN IMMEDIATE');
          try {
            for(const item of input.items) {
              if(!uuid(item.recordId)||!uuid(item.batchId)||!Array.isArray(item.platforms)||!item.platforms.length)throw new Error('Некорректный запуск.');
              const old=getAd(p.id,item.recordId);
              if(old?.sold || old?.archived)throw new Error('Товар продан или убран в архив.');
              for(const platform of item.platforms) {
                if(!getPlatforms(item.listing.category,item.listing.taxonomyId).some(p=>p.id===platform.id))throw new Error('Неизвестная площадка.');
                const previous=db.prepare('SELECT batch_id FROM launches WHERE profile_id=? AND record_id=? AND platform_id=?').get(p.id,item.recordId,platform.id);
                const job=old?.jobs.find(j=>j.platformId===platform.id);
                if(input.verify===true && (!previous || previous.batch_id!==item.batchId))throw new Error('Запуск не подтверждён в кабинете.');
                if(input.verify!==true && previous || job && (job.batchId||old.batchId)!==item.batchId && (job.url||!['draft','ready','cancelled','unsupported'].includes(job.status)))
                  throw new Error('Для этой карточки уже есть задание на площадке. Продолжите его из кабинета; повторная подача заблокирована.');
                if(!old || !job || (job.batchId||old.batchId)!==item.batchId)throw Object.assign(new Error('Ожидаем сохранения карточки перед подачей.'),{status:409,code:'WAIT_FOR_SAVE'});
                const expected={...old.listing,title:listingTitle(old.listing),description:descriptionWithAttributes(old.listing,old.attributes,old.categoryOverrides)};
                if(Object.entries(expected).some(([key,value])=>item.listing[key]!==value) || JSON.stringify(item.photoIds||[])!==JSON.stringify(old.photos.map(p=>p.id)) || !sameMap(item.platformText,old.platformText) || !sameMap(item.categoryOverrides,old.categoryOverrides) || !sameMap(item.attributes,old.attributes))
                  throw new Error('Карточка изменилась после подготовки. Обновите её и проверьте задание перед подачей.');
                if(old.listing.quantity==='0'||old.listing.availability==='Нет в наличии')throw new Error('Товар отсутствует в наличии.');
                if(input.verify!==true) {
                  if(db.prepare('SELECT count(*) AS n FROM launches WHERE profile_id=?').get(p.id).n>=3500)throw new Error('Достигнут лимит запусков кабинета.');
                  db.prepare('INSERT OR IGNORE INTO launches VALUES(?,?,?,?,?)').run(p.id,item.recordId,platform.id,item.batchId,new Date().toISOString());
                }
              }
            }
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
        }
        return reply({recipes});
      }
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
        return reply({ ad: saveAd(p.id, {...await body(req),_actor:p.name}) });
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
        const saved = db.prepare("SELECT data FROM settings WHERE profile_id=?").get(p.id);
        const previous = saved ? JSON.parse(saved.data) : {};
        const phone = clean(input.phone === undefined ? previous.phone : input.phone, 40);
        if (phone && !/^\+375\d{9}$/.test(phone.replace(/[\s()-]/g, "")))
          throw new Error("Телефон в формате +375XXXXXXXXX.");
        const settings = {
          company: clean(input.company === undefined ? previous.company : input.company, 150),
          contactPerson: clean(input.contactPerson === undefined ? previous.contactPerson : input.contactPerson, 100),
          phone,
          city: clean(input.city === undefined ? previous.city : input.city, 100),
          importPresets: (Array.isArray(input.importPresets)?input.importPresets:previous.importPresets||[]).slice(0,30).map(p=>({
            id:clean(p.id,80),name:clean(p.name,80),categoryId:categoryById(p.categoryId)?.id||'',url:clean(p.url,2000),
            columns:Object.fromEntries(Object.entries(p.columns||{}).slice(0,100).filter(([k,v])=>k.length<=200 && typeof v==='string' && v.length<=50))
          })).filter(p=>p.id&&p.name),
          templates:cleanTemplates(input.templates===undefined?previous.templates:input.templates),
          integrations: {},
        };
        for (const platform of ["kufar", "bamper", "flagma"])
          settings.integrations[platform] = {
            enabled: (input.integrations?.[platform] ?? previous.integrations?.[platform])?.enabled === true,
            notes: clean((input.integrations?.[platform] ?? previous.integrations?.[platform])?.notes, 400),
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
          ...(e.code==='WAIT_FOR_SAVE'?{code:e.code}:{}),
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
