"use client";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { legacyDrafts } from "../lib/legacy";
import { PriceComparison } from "./price-comparison";
import { CategoryAttributes } from "./category-attributes";
import {Readiness,QueueView,BulkEdit,History} from './operations';
import {availablePlatforms} from '../lib/readiness';
import type {ImportPreset} from '../lib/catalog-import';
import {SellerTemplates} from './seller-templates';
import {TeamView,Assignee} from './team';
import {Notifications} from './notifications';
import {cleanAttributes,describeAttributes,descriptionWithAttributes} from "../lib/attributes";
import {
  ArrowRight,
  Check,
  ClipboardList,
  Download,
  ExternalLink,
  FileUp,
  Globe2,
  ImagePlus,
  Layers3,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings2,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  emptyListing,
  fields,
  partFields,
  generalFields,
  listingTitle,
  parseLocally,
  sample,
  partsSample,
  sanitizeListing,
  validateListing,
  type Listing,
} from "../lib/listing";
import {
  categories,
  categoryById,
  suggestCategories,
  taxonomy,
  categoryMapping,
  mappingLabel,
  mappingOptions,
  type CategoryOverrides,
  type Candidate,
} from "../lib/taxonomy";
import {
  defaultPlatforms,
  getPlatforms,
  platformValidation,
  safePublicationUrl,
  statusLabel,
  remoteStatusLabel,
  cleanRemoteStatus,
  type Job,
} from "../lib/platforms";
import {
  api,
  setWorkspaceContext,
  download,
  extension,
  EXTENSION_VERSION,
  extensionVersionOK,
  withSellerContacts,
  type SellerContacts,
  newRecord,
  optimizePhoto,
  type AdRecord,
  type AdSummary,
  type Profile,
  type Photo,
} from "../lib/workspace";
import {
  csvExport,
  flagmaXlsx,
  guessColumns,
  importFields,
  normalizeImport,
  matchingPhotos,
  readImport,
  type ImportTable,
} from "../lib/bulk";

export function Logo() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <Layers3 size={23} />
      </span>
      автопост<span className="brand-period">.</span>
    </span>
  );
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Не удалось выполнить действие.";
function CategorySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = categories.filter(
    (c) =>
      c.id === value ||
      `${c.parent} ${c.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="category-search">
      <label className="full-label">
        Найти категорию
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Например: фара, ноутбук, мебель"
        />
      </label>
      <label className="full-label">
        Категория Автопоста
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Выберите категорию</option>
          {filtered.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent} / {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
function MarketplaceCategories({categoryId,overrides,onChange}:{categoryId:string;overrides:CategoryOverrides;onChange:(value:CategoryOverrides)=>void}) {
  const category=categoryById(categoryId);
  const [search,setSearch]=useState<Record<string,string>>({});
  if(!category)return null;
  return <section className="category-routing" aria-label="Категории площадок">
    <h3>Категории на площадках</h3>
    <p className="hint">Одна категория Автопоста — соответствия для всех площадок. При необходимости измените отдельное соответствие.</p>
    {getPlatforms(category.group,category.id).map(p=>{
      const mapping=categoryMapping(category.id,p.canonicalId,overrides);
      const options=mappingOptions(p.canonicalId);
      return <div className="routing-entry" key={p.id}>
        <b>{p.name}</b>
        <div><span>{mapping?mappingLabel(mapping):options.length?'Нет подтверждённого соответствия — выберите категорию ниже':'Справочник пока не подключён; категория выбирается на площадке'}</span>
          {mapping?.match==='broader'&&<small>Более общий раздел площадки; уточнения зависят от характеристик товара.</small>}
          {options.length>0&&<details><summary>{overrides[p.canonicalId]?'Изменено вручную':'Изменить для этой площадки'}</summary>
            <input aria-label={`Поиск категории ${p.name}`} placeholder="Поиск по категориям площадки" value={search[p.id]||''} onChange={e=>setSearch({...search,[p.id]:e.target.value})}/>
            <small>Поиск по полному справочнику. Показано до 100 совпадений.</small>
            <select aria-label={`Категория ${p.name}`} value={overrides[p.canonicalId]||''} onChange={e=>{const next={...overrides};if(e.target.value)next[p.canonicalId]=e.target.value;else delete next[p.canonicalId];onChange(next);}}>
              <option value="">Автоматически{category.mappings[p.canonicalId]?': '+mappingLabel(category.mappings[p.canonicalId]):' — соответствие не найдено'}</option>
              {options.filter(m=>m.optionId===overrides[p.canonicalId]||mappingLabel(m).toLowerCase().includes((search[p.id]||'').toLowerCase())).sort((a,b)=>Number(b.optionId===overrides[p.canonicalId])-Number(a.optionId===overrides[p.canonicalId])).slice(0,100).map(m=><option key={m.optionId} value={m.optionId}>{mappingLabel(m)}</option>)}
            </select>
          </details>}
        </div>
      </div>;
    })}
  </section>;
}
export function Auth({
  profiles,
  onLogin,
  onError,
}: {
  profiles: Profile[];
  onLogin: (p: Profile) => void;
  onError: (s: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">(
      profiles.length ? "login" : "register",
    ),
    [login, setLogin] = useState(profiles[0]?.login || ""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ profile: Profile }>("workspace/" + mode, {
        login,
        password,
        name,
      });
      setPassword("");
      onLogin(result.profile);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-intro">
        <Logo />
        <span className="eyebrow">ВАШ КАБИНЕТ ПРОДАВЦА</span>
        <h1>
          Одна карточка.
          <br />
          Все размещения рядом.
        </h1>
        <p>
          Подготовьте объявление, выберите площадки и следите за заданиями в
          своём профиле.
        </p>
        <div className="auth-points">
          <span>
            <Sparkles size={19} />
            Категория и описание с помощью ИИ
          </span>
          <span>
            <Globe2 size={19} />
            Площадки Беларуси в одном окне
          </span>
          <span>
            <ClipboardList size={19} />
            Объявления, очередь и ссылки
          </span>
        </div>
      </div>
      <form className="panel auth-form" onSubmit={submit}>
        <h2>{mode === "register" ? "Создать профиль" : "Выбрать профиль"}</h2>
        <p className="section-subtitle">
          Без почты, телефона и подтверждений. Только логин и пароль.
        </p>
        <div className="segmented">
          <button
            type="button"
            aria-pressed={mode === "login"}
            onClick={() => setMode("login")}
          >
            Войти
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => {
              setMode("register");
              setLogin("");
            }}
          >
            Новый профиль
          </button>
        </div>
        {mode === "login" && profiles.length > 0 && (
          <label className="full-label">
            Сохранённые профили
            <select value={login} onChange={(e) => setLogin(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.login}>
                  {p.name} · {p.login}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="full-label">
          Логин
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            minLength={2}
            maxLength={40}
            required
          />
        </label>
        {mode === "register" && (
          <label className="full-label">
            Имя профиля
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Например, Илья или Мой магазин"
            />
          </label>
        )}
        <label className="full-label">
          Пароль
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            minLength={6}
            maxLength={128}
            required
          />
        </label>
        <button className="primary big" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <ArrowRight size={18} />
          )}{" "}
          {mode === "register" ? "Создать и войти" : "Войти в кабинет"}
        </button>
        <p className="fine-print">
          Это профили MVP. Восстановление пароля пока не подключено. Объявления
          сохраняются на сервере отдельно для каждого профиля.
        </p>
      </form>
    </div>
  );
}

export function Workspace({
  profile,
  onLogout,
  notify,
}: {
  profile: Profile;
  onLogout: () => void;
  notify: (s: string) => void;
}) {
  const [view, setView] = useState("editor"),
    [ad, setAd] = useState<AdRecord>(() => newRecord({ ...emptyListing })),
    [ads, setAds] = useState<AdSummary[]>([]),
    [dirty, setDirty] = useState(0),
    [saveState, setSaveState] = useState("Новая карточка"),
    [busy, setBusy] = useState(""),
    [checked, setChecked] = useState(false),
    [publishMode, setPublishMode] = useState<PublishMode>('manual'),
    [ext, setExt] = useState(false),
    [pendingChecks, setPendingChecks] = useState(0),
    [queuePaused, setQueuePaused] = useState(false),
    [contacts, setContacts] = useState<SellerContacts>({}),
    [extensionChecking, setExtensionChecking] = useState(false),
    [extensionStatus, setExtensionStatus] = useState("Проверяем подключение…"),
    [serverAI, setServerAI] = useState(false),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [photoSuggestion,setPhotoSuggestion]=useState<{description:string;candidates:Candidate[];questions:string[]}|null>(null),
    [categoryId, setCategoryId] = useState(""),
    [pendingOverrides,setPendingOverrides] = useState<CategoryOverrides>({}),
    [errors, setErrors] = useState<string[]>([]),
    [showExtension, setShowExtension] = useState(false);
  const current = useRef(ad),
    revisions = useRef(new Map<string, number>()),
    saveQueue = useRef(Promise.resolve()),
    progressQueue = useRef(Promise.resolve()),
    alive = useRef(true),
    seenProgress = useRef(new Map<string, string>()),
    photoInput = useRef<HTMLInputElement>(null),
    photoUploading = useRef(false);
  const extensionCheck = useRef<Promise<void> | null>(null);
  const extensionConnected = useRef(false);
  const contactDefaults = useRef<SellerContacts>({});
  const contactsReady = useRef<Promise<SellerContacts> | null>(null);
  function saveContactDefaults(value: SellerContacts) {
    contactDefaults.current = value;
    setContacts(value);
  }
  function checkExtension(showNotice = false): Promise<void> {
    if (extensionCheck.current) return extensionCheck.current;
    setExtensionChecking(true);
    const operation = extension("PING")
      .then((result) => {
        const ok = extensionVersionOK(result.version);
        const message = ok ? `Расширение ${result.version} подключено.`
          : `Установлена версия ${result.version}. Обновите расширение до ${EXTENSION_VERSION}.`;
        extensionConnected.current = ok;
        if (alive.current) { setExt(ok); setExtensionStatus(message); if (showNotice) notify(message); }
      })
      .catch((error) => {
        extensionConnected.current = false;
        if (alive.current) { setExt(false); setExtensionStatus(errorText(error)); if (showNotice) notify(errorText(error)); }
      })
      .finally(() => { extensionCheck.current = null; if (alive.current) setExtensionChecking(false); });
    extensionCheck.current = operation;
    return operation;
  }
  function change(next: AdRecord | ((r: AdRecord) => AdRecord)) {
    const value = typeof next === "function" ? next(current.current) : next;
    current.current = value;
    setAd(value);
    setDirty((n) => n + 1);
    setSaveState("Есть несохранённые изменения");
    setChecked(false);
  }
  async function refresh() {
    const before=current.current;
    const result = await api<{ ads: AdSummary[] }>("workspace/ads");
    if (alive.current) setAds(result.ads);
    if(!dirty && current.current===before && (result.ads.find(r=>r.id===before.id)?.revision||0)>before.revision){
      const fresh=(await api<{ad:AdRecord}>('workspace/ads/'+before.id)).ad;
      if(alive.current&&current.current===before){current.current=fresh;revisions.current.set(fresh.id,fresh.revision);setAd(fresh);}
    }
  }
  function persist(snapshot: AdRecord = current.current) {
    let result: AdRecord;
    const operation = saveQueue.current.then(async () => {
      if (!alive.current) throw new Error("Профиль закрыт. Войдите снова.");
      if (alive.current) setSaveState("Сохраняем…");
      const r = await api<{ ad: AdRecord }>("workspace/ads", {
        ...snapshot,
        profileId: profile.id,
        revision: revisions.current.get(snapshot.id) ?? snapshot.revision,
      });
      result = r.ad;
      revisions.current.set(snapshot.id, r.ad.revision);
      if (alive.current) {
        const unchanged=current.current===snapshot;
        const jobsUnchanged=current.current.jobs===snapshot.jobs;
        if (current.current.id === snapshot.id) {
          current.current = {
            ...current.current,
            revision: r.ad.revision,
            contentVersion:r.ad.contentVersion,
            jobs:current.current.jobs.map(j=>({...j,sentVersion:r.ad.jobs.find(s=>s.platformId===j.platformId)?.sentVersion||j.sentVersion})),
            updatedAt: r.ad.updatedAt,
            events: r.ad.events,
          };
          setAd(current.current);
          if(unchanged)setDirty(0);
        }
        if (current.current.id === snapshot.id)
          setSaveState(
            current.current.listing === snapshot.listing &&
              current.current.text === snapshot.text &&
              current.current.photos === snapshot.photos &&
              jobsUnchanged &&
              current.current.selected === snapshot.selected &&
              current.current.categoryConfirmed === snapshot.categoryConfirmed &&
              current.current.prepared === snapshot.prepared &&
              current.current.archived === snapshot.archived &&
              current.current.categoryOverrides === snapshot.categoryOverrides &&
              current.current.batchId === snapshot.batchId
              ? "Сохранено в профиле"
              : "Есть несохранённые изменения",
          );
        setAds((list) => [
          { ...r.ad, photoCount: r.ad.photos.length },
          ...list.filter((a) => a.id !== r.ad.id),
        ]);
      }
    });
    saveQueue.current = operation.catch(() => undefined);
    return operation.then(() => result!);
  }
  async function receive(batch: {
    profileId?: string;
    batchId: string;
    recordId: string;
    jobs: Job[];
    receiptId?: string;
  }) {
    if (batch.profileId && batch.profileId !== profile.id) return;
    if (!batch.recordId || !Array.isArray(batch.jobs)) return;
    const signature = JSON.stringify(batch.jobs);
    if (seenProgress.current.get(batch.batchId) === signature) { await acknowledge(batch.receiptId); return; }
    let record =
      current.current.id === batch.recordId
        ? current.current
        : (await api<{ ad: AdRecord }>("workspace/ads/" + batch.recordId)).ad;
    if (record.batchId !== batch.batchId && !record.jobs.some(j=>j.batchId===batch.batchId)) return;
    record = {
      ...record,
      jobs: record.jobs.map(
        (job) => { const next = (job.batchId||record.batchId)===batch.batchId && batch.jobs.find((j) => j.platformId === job.platformId); return next ? {...job,...next,batchId:batch.batchId,...(next.url && next.url!==job.url?{remoteStatus:undefined}:{})} : job; },
      ),
    };
    if (current.current.id === record.id) {
      current.current = record;
      setAd(record);
    }
    await persist(record);
    seenProgress.current.set(batch.batchId, signature);
    await acknowledge(batch.receiptId);
  }
  async function acknowledge(receiptId?:string) {
    if (receiptId && alive.current) await extension("ACK_RECEIPT",{profileId:profile.id,receiptId});
  }
  async function receiveStatus(result:{profileId:string;recordId:string;platformId:string;url:string;remoteStatus:Job['remoteStatus'];receiptId?:string}) {
    if (!alive.current || result.profileId !== profile.id) return;
    const status = cleanRemoteStatus(result.remoteStatus);
    if (!status) return;
    let record = current.current.id === result.recordId ? current.current
      : (await api<{ad:AdRecord}>("workspace/ads/"+result.recordId)).ad;
    const job = record.jobs.find(j=>j.platformId===result.platformId && j.url===result.url);
    if (!job) { await acknowledge(result.receiptId); return; }
    if (!job.remoteStatus || Date.parse(job.remoteStatus.checkedAt)<Date.parse(status.checkedAt)) {
      record = {...record,jobs:record.jobs.map(j=>j===job?{...j,remoteStatus:status}:j)};
      if (current.current.id === record.id) { current.current=record;setAd(record); }
      await persist(record);
    }
    await acknowledge(result.receiptId);
  }
  async function checkStatuses(records:AdSummary[]) {
    if (!ext) { setShowExtension(true); return; }
    const items = records.flatMap(record=>record.jobs.filter(j=>j.url).map(j=>({recordId:record.id,platformId:j.platformId,url:j.url,title:listingTitle(record.listing)})));
    if (!items.length) { notify("Сначала сохраните ссылку на объявление. После подачи помощник попробует получить её автоматически."); return; }
    await guarded(async()=>{
      const result = await extension("CHECK_STATUS",{profileId:profile.id,items},25000);
      setPendingChecks(Number(result.pendingChecks)||0);
      notify(`Запущена проверка ${items.length} ссылок. Результаты появятся у площадок в кабинете.`);
    },"Запускаем проверку");
  }
  useEffect(() => {
    alive.current = true;
    setWorkspaceContext(profile.id);
    void refresh().catch((e) => notify(errorText(e)));
    void checkExtension();
    contactsReady.current = api<{settings: SellerContacts}>("workspace/settings").then(({settings}) => {
      if (alive.current) {
        saveContactDefaults(settings);
        if (!current.current.revision && !current.current.categoryConfirmed) {
          const next = { ...current.current, listing: withSellerContacts(current.current.listing, settings) };
          current.current = next;
          setAd(next);
        }
      }
      return settings;
    }).catch(error => { if(alive.current) notify(errorText(error)); return {}; });
    api<{ serverConfigured: boolean }>("ai-settings")
      .then((r) => setServerAI(r.serverConfigured))
      .catch(() => {});
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.source !== "autopost-extension"
      )
        return;
      if (event.data.type === "READY") { void checkExtension(); return; }
      if (!["PROGRESS","REMOTE_STATUS"].includes(event.data.type)) return;
      progressQueue.current = progressQueue.current
        .then(() => event.data.type === "REMOTE_STATUS" ? receiveStatus(event.data.payload) : receive(event.data.payload))
        .catch((e) => notify(errorText(e)));
    };
    window.addEventListener("message", listener);
    const reconnect = () => { void checkExtension(); };
    window.addEventListener("focus", reconnect);
    const timer = setInterval(
      () =>
        extensionConnected.current && extension("STATUS", { profileId: profile.id }, 5000)
          .then((r) => {
            if (alive.current) setPendingChecks(Number(r.pendingChecks)||0);
            if (alive.current && Array.isArray(r.batches) && r.batches.length) setQueuePaused(r.batches.every(b=>b.paused));
            if (Array.isArray(r.receipts)) for (const receipt of r.receipts)
              progressQueue.current = progressQueue.current.then(()=>receipt.kind==='status'?receiveStatus(receipt):receive(receipt)).catch(()=>undefined);
            if (Array.isArray(r.batches))
              for (const b of r.batches)
                progressQueue.current = progressQueue.current
                  .then(() => receive(b))
                  .catch(() => undefined);
          })
          .catch(() => {}),
      6000,
    );
    return () => {
      alive.current = false;
      setWorkspaceContext('');
      clearInterval(timer);
      window.removeEventListener("message", listener);
      window.removeEventListener("focus", reconnect);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(
      () =>
        void persist().catch((e) => {
          setSaveState("Не удалось сохранить");
          notify(errorText(e));
        }),
      700,
    );
    return () => clearTimeout(timer);
  }, [dirty]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (
        saveState === "Сохраняем…" ||
        saveState === "Есть несохранённые изменения" || saveState === "Не удалось сохранить"
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [saveState]);
  async function guarded(action: () => Promise<void>, label: string) {
    if (busy) return;
    setBusy(label);
    try {
      await action();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function logout() {
    await guarded(async () => {
      if (ext) await extension("PAUSE", { profileId: profile.id });
      if (dirty) await persist();
      await api("workspace/logout", {});
      onLogout();
    }, "Выходим");
  }
  async function navigate(next: string) {
    await guarded(async () => {
      if (dirty) await persist();
      setView(next);
      if (next === "cabinet") await refresh();
    }, "Сохраняем");
  }
  async function openRecord(id: string) {
    await guarded(async () => {
      if (dirty) await persist();
      const r = await api<{ ad: AdRecord }>("workspace/ads/" + id);
      current.current = r.ad;
      revisions.current.set(id, r.ad.revision);
      setAd(r.ad);
      setDirty(0);
      setCategoryId(r.ad.listing.taxonomyId);
      setPendingOverrides(r.ad.categoryOverrides||{});
      setCandidates([]);
      setPhotoSuggestion(null);
      setChecked(false);
      setErrors([]);
      setView("editor");
    }, "Открываем");
  }
  async function fresh() {
    await guarded(async () => {
      if (dirty) await persist();
      await contactsReady.current;
      const value = newRecord(withSellerContacts({ ...emptyListing }, contactDefaults.current));
      current.current = value;
      setAd(value);
      setDirty(0);
      setCategoryId("");
      setPendingOverrides({});
      setCandidates([]);
      setPhotoSuggestion(null);
      setErrors([]);
      setChecked(false);
      setView("editor");
    }, "Сохраняем");
  }
  function selectCategory(id:string){
    if(current.current.prepared&&id!==current.current.listing.taxonomyId)change(r=>({...r,categoryConfirmed:false}));
    setCategoryId(id);
    setPendingOverrides(id===current.current.listing.taxonomyId?current.current.categoryOverrides||{}:{});
  }
  async function classify() {
    await guarded(async () => {
      if (current.current.text.trim().length < 3)
        throw new Error("Опишите товар хотя бы в 3 символах.");
      if (serverAI) {
        const r = await api<{ candidates: Candidate[]; question?: string }>(
          "analyze",
          { task: "classify", text: current.current.text },
        );
        setCandidates(r.candidates);
        selectCategory(r.candidates[0]?.id || "");
        if (r.question) notify(r.question);
      } else {
        const result = suggestCategories(current.current.text);
        setCandidates(result);
        selectCategory(result[0]?.id || "");
        notify(
          "Сейчас доступен поиск по словам. Выберите категорию из справочника.",
        );
      }
    }, "Определяем категорию");
  }
  async function prepare(id = current.current.listing.taxonomyId) {
    await guarded(async () => {
      const category = categoryById(id);
      if (!category) throw new Error("Выберите категорию.");
      const source = current.current;
      let listing: Listing;
      if (serverAI) {
        const result = await api<{ listing: Listing }>("analyze", {
          text: source.text,
          category: category.group,
          taxonomyId: id,
        });
        listing = sanitizeListing(result.listing, category.group);
      } else listing = parseLocally(source.text, category.group);
      listing.taxonomyId = category.id;
      await contactsReady.current;
      const explicitContacts = parseLocally(source.text, category.group);
      listing = withSellerContacts(listing, {
        phone: explicitContacts.phone || source.listing.phone || contactDefaults.current.phone,
        city: explicitContacts.city || source.listing.city || contactDefaults.current.city,
      });
      change({
        ...source,
        listing,
        attributes: cleanAttributes(listing,source.attributes,pendingOverrides),
        categoryConfirmed: true,
        categoryOverrides: pendingOverrides,
        prepared: true,
        selected: defaultPlatforms(category.group, category.id, pendingOverrides),
        jobs: source.jobs,
        batchId: source.batchId,
      });
      await persist();
      notify("Карточка подготовлена. Проверьте характеристики и контакты.");
    }, "Готовим карточку");
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    if (busy || photoUploading.current) {
      notify("Дождитесь завершения текущего действия и добавьте фото снова.");
      return;
    }
    photoUploading.current = true;
    try {
      await guarded(async () => {
        const recordId = current.current.id;
        const available = 12 - current.current.photos.length;
        if (available <= 0) throw new Error("Можно добавить до 12 фотографий. Удалите лишнее фото и попробуйте снова.");
        const photos: Photo[] = [];
        for (const f of Array.from(files).slice(0, available))
          photos.push(await optimizePhoto(f));
        if (!alive.current || current.current.id !== recordId) return;
        change((r) => ({ ...r, photos: [...r.photos, ...photos].slice(0, 12) }));
        notify(`Добавлено фото: ${photos.length}.${files.length > available ? " Лимит — 12 фотографий на объявление." : ""}`);
      }, "Обрабатываем фото");
    } finally {
      photoUploading.current = false;
      if (photoInput.current) photoInput.current.value = "";
    }
  }
  function pastePhotos(event: ClipboardEvent<HTMLElement>) {
    if (view !== "editor" || showExtension) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    // Some browsers expose pasted files only through the FileList.
    if (!files.length)
      files.push(...Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")));
    if (!files.length) return; // Ordinary text paste keeps its native behavior.
    event.preventDefault();
    void upload(files);
  }
  function launchPayload(record: AdRecord) {
    const listing=sanitizeListing(record.listing);
    return {
      publishMode,
      batchId: record.batchId,
      recordId: record.id,
      profileId: profile.id,
      categoryOverrides: record.categoryOverrides||{},
      attributes: record.attributes || {},
      platformText: record.platformText || {},
      photoIds:record.photos.map(p=>p.id),
      listing: { ...listing, title: listingTitle(listing), description: descriptionWithAttributes(listing,record.attributes,record.categoryOverrides) },
      photos: record.photos.map(({ name, type, dataUrl }) => ({
        name,
        type,
        dataUrl,
      })),
      platforms: record.selected.map((id) => ({ id })),
    };
  }
  async function start() {
    const r = current.current;
    const targets=availablePlatforms(r);
    // A different marketplace can be added while existing jobs and links stay intact.
    const invalid = [
      ...(r.sold?['Товар отмечен проданным']:[]),
      ...(r.listing.availability==='Нет в наличии'||r.listing.quantity==='0'?['Товар отсутствует в наличии. Уточните наличие перед подачей.']:[]),
      ...validateListing(r.listing),
      ...platformValidation(r.listing, r.selected, r.categoryOverrides),
      ...(!r.categoryConfirmed ? ["Подтвердите категорию"] : []),
      ...(!r.prepared ? ["Подготовьте карточку"] : []),
      ...(!r.photos.length ? ["Добавьте фотографии"] : []),
      ...(!r.selected.length ? ["Выберите площадки"] : []),
      ...(!targets.length ? ['На выбранных площадках уже есть задания. Продолжите их из раздела «Готовность к размещению».'] : []),
      ...(!checked ? ["Подтвердите проверку данных"] : []),
    ];
    setErrors(invalid);
    if (invalid.length) return;
    if (!ext) {
      setShowExtension(true);
      return;
    }
    await guarded(async () => {
      const batchId=crypto.randomUUID();
      const launched = {
        ...r,
        batchId,
        jobs: [...r.jobs.filter(j=>!targets.includes(j.platformId)).map(j=>({...j,batchId:j.batchId||r.batchId})),...targets.map((platformId) => ({
          batchId,
          platformId,
          status: "opening",
          message: "Открываем выбранную площадку.",
        }))],
      };
      current.current = launched;
      setAd(launched);
      const responsePromise = extension("RUN", launchPayload({...launched,selected:targets}), 25000);
      // Attach rejection immediately: network failure can precede the server save.
      void responsePromise.catch(()=>undefined);
      try {
        await persist(launched);
        const response = await responsePromise;
        if (Array.isArray(response.jobs)) {
          await receive({
            batchId: launched.batchId,
            recordId: launched.id,
            jobs: response.jobs as Job[],
          });
        }
      } catch (e) {
        const latest=await api<{ad:AdRecord}>('workspace/ads/'+r.id).catch(()=>null);
        if(latest && latest.ad.batchId!==launched.batchId){revisions.current.set(r.id,latest.ad.revision);current.current=latest.ad;setAd(latest.ad);await refresh();throw e;}
        change((a) => ({
          ...a,
          jobs: a.jobs.map((j) => targets.includes(j.platformId) ? ({
            ...j,
            status: "error",
            message: errorText(e),
          }) : j),
        }));
        throw e;
      }
    }, "Открываем площадки");
  }
  async function openJob(job: Job, record: AdSummary | AdRecord = current.current) {
    if (!ext) {
      setShowExtension(true);
      return;
    }
    await guarded(async () => {
      const batchId = job.batchId || record.batchId || crypto.randomUUID();
      const response = await extension("OPEN_JOB", {
        profileId: profile.id,
        batchId,
        recordId: record.id,
        platformId: job.platformId,
      });
      if (typeof response.resumeToken === "string") {
        // The first request records the user's click before the server/photo read.
        // Restore only this marketplace, without switching the editor or other jobs.
        let full = current.current.id === record.id ? current.current
          : (await api<{ad: AdRecord}>("workspace/ads/" + record.id)).ad;
        if (!alive.current) return;
        if (!job.batchId && full.batchId !== batchId) {
          full = {...full,batchId,jobs:full.jobs.map(j=>j.platformId===job.platformId?{...j,batchId}:j)};
          if (current.current.id === full.id) {current.current=full;setAd(full);}
          full = await persist(full);
        }
        const restored = await extension("RESTORE_JOB", {
          profileId: profile.id,
          resumeToken: response.resumeToken,
          item: {...launchPayload({...full, batchId}), publishMode: 'manual', platforms: [{id: job.platformId}]},
        }, 25000);
        if (Array.isArray(restored.jobs)) await receive({batchId, recordId: record.id, jobs: restored.jobs as Job[]});
      } else if (Array.isArray(response.jobs)) {
        await receive({batchId, recordId: record.id, jobs: response.jobs as Job[]});
      }
    }, "Открываем");
  }
  const node = categoryById(ad.listing.taxonomyId),
    platforms = getPlatforms(ad.listing.category, ad.listing.taxonomyId),
    definitions =
      ad.listing.category === "parts"
        ? partFields
        : ad.listing.category === "general"
          ? generalFields
          : fields;
  const update = (key: keyof Listing, value: string) =>
    change((r) => {const listing={ ...r.listing, [key]: value }; return { ...r, listing, attributes:cleanAttributes(listing,r.attributes,r.categoryOverrides) };});
  const nav = [
    ["editor", "Новое объявление", Plus],
    ["cabinet", "Мои объявления", ClipboardList],
    ["queue", "Очередь и уведомления", Layers3],
    ["profile", "Мой профиль", UserRound],
    ["team", "Команда", UserRound],
    ["bulk", "Массовая загрузка", FileUp],
    ["edit-many", "Массовые изменения", Settings2],
    ["taxonomy", "Справочник площадок", Globe2],
    ["integrations", "Интеграции", Settings2],
  ] as const;
  return (
    <div className="app-shell workspace-v3">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-label">КАБИНЕТ ПРОДАВЦА</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={"nav-item " + (view === id ? "active" : "")}
              disabled={!!busy}
              onClick={() =>
                id === "editor" ? void fresh() : void navigate(id)
              }
              title={label}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <b>Автопост · MVP 0.8</b>
          <p>Карточки и статусы хранятся в вашем профиле на сервере.</p>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setShowExtension(true)}>
            <Globe2 size={18} />
            {ext ? "Расширение подключено" : "Установить расширение"}
          </button>
          <div className="profile">
            <span className="avatar">
              <UserRound size={17} />
            </span>
            <span>
              <b>{profile.name}</b>
              <small>{profile.login}</small>
            </span>
            <button title="Сменить профиль" onClick={() => void logout()}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            {profile.name}
            <span> / </span>
            {nav.find((n) => n[0] === view)?.[1]}
          </div>
          <div className="top-actions">
            <span className="country">🇧🇾 Беларусь</span>
            <button
              className="text-button"
              onClick={() => setShowExtension(true)}
            >
              {ext ? "Помощник подключён" : `Расширение ${EXTENSION_VERSION}`}
            </button>
          </div>
        </header>
        <div className="mobile-nav">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              aria-label={label}
              aria-pressed={view === id}
              onClick={() =>
                id === "editor" ? void fresh() : void navigate(id)
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
          <button aria-label="Сменить профиль" onClick={() => void logout()}>
            <LogOut size={18} />
          </button>
        </div>
        <main onPaste={pastePhotos}>
          <Notifications ads={ads} expanded={view==='queue'} onCard={openRecord} notify={notify} />
          {view === "editor" && (
            <>
              <div className="heading-row">
                <div>
                  <div className="eyebrow">
                    <span className="blue-dot" />
                    ОДНА КАРТОЧКА ДЛЯ ВСЕХ ПЛОЩАДОК
                  </div>
                  <h1>
                    {ad.categoryConfirmed
                      ? "Подготовьте объявление"
                      : "Что вы хотите продать?"}
                  </h1>
                  <p className="subtitle">
                    {ad.categoryConfirmed
                      ? `${node?.parent} / ${node?.name}`
                      : "Опишите товар. Мы предложим категорию и подходящие площадки."}
                  </p>
                </div>
                <span className="draft-pill">{saveState}</span>
              </div>
              <div className="steps">
                <div className="step current">
                  <span>0</span>
                  <b>Категория</b>
                </div>
                <div className="step-line" />
                <div
                  className={"step " + (ad.categoryConfirmed ? "current" : "")}
                >
                  <span>1</span>
                  <b>Карточка</b>
                </div>
                <div className="step-line" />
                <div className={"step " + (ad.jobs.length ? "current" : "")}>
                  <span>2</span>
                  <b>Размещение</b>
                </div>
              </div>
              <div className="content-grid">
                <div className="editor-column">
                  <section className="panel compose">
                    <div className="section-title">
                      <div>
                        <span className="section-number">00</span>
                        <h2>Описание и категория</h2>
                      </div>
                      <span className="soft-badge">
                        <Sparkles size={13} />
                        {serverAI
                          ? "DeepSeek подключён"
                          : "Поиск по справочнику"}
                      </span>
                    </div>
                    <div className="textarea-wrap">
                      <textarea
                        aria-label="Предварительное описание товара"
                        value={ad.text}
                        maxLength={8000}
                        onChange={(e) =>
                          change((r) => ({ ...r, text: e.target.value }))
                        }
                        placeholder="Например: продам левую фару для Volkswagen Passat B8, артикул 3G1941035D, б/у. Цена 450 BYN. Минск."
                      />
                      <div className="textarea-bottom">
                        <button
                          onClick={() =>
                            change((r) => ({ ...r, text: partsSample }))
                          }
                        >
                          Пример запчасти
                        </button>
                        <button
                          onClick={() =>
                            change((r) => ({ ...r, text: sample }))
                          }
                        >
                          Пример автомобиля
                        </button>
                        <span>{ad.text.length} / 8000</span>
                      </div>
                    </div>
                    <MarketplaceCategories categoryId={categoryId} overrides={pendingOverrides} onChange={value=>{
                      setPendingOverrides(value);
                      if(categoryId===ad.listing.taxonomyId)change(r=>({...r,categoryOverrides:value}));
                    }}/>
                    <div className="prepare-row">
                      <span className="hint">ИИ использует только текст</span>
                      <button
                        className="primary"
                        disabled={!!busy || ad.text.trim().length < 3}
                        onClick={classify}
                      >
                        <Sparkles size={16} />
                        {busy === "Определяем категорию"
                          ? busy
                          : "Определить категорию"}
                      </button>
                    </div>
                    {candidates.length > 0 && (
                      <div className="category-candidates">
                        {candidates.map((c) => {
                          const n = categoryById(c.id)!;
                          return (
                            <label
                              key={c.id}
                              className={categoryId === c.id ? "selected" : ""}
                            >
                              <input
                                type="radio"
                                name="suggested-category"
                                checked={categoryId === c.id}
                                onChange={() => selectCategory(c.id)}
                              />
                              <span>
                                <b>{n.name}</b>
                                <small>
                                  {n.parent} · {c.reason}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <CategorySelect
                      value={categoryId}
                      onChange={selectCategory}
                    />
                    <div className="prepare-row">
                      <span className="hint">
                        Вы подтверждаете выбор перед подготовкой
                      </span>
                      <button
                        className="primary"
                        disabled={
                          !categoryId || !!busy || ad.text.trim().length < 3
                        }
                        onClick={() => prepare(categoryId)}
                      >
                        {busy === "Готовим карточку"
                          ? busy
                          : ad.categoryConfirmed
                            ? "Пересобрать карточку"
                            : "Подтвердить и продолжить"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="divider" />
                    <div className="photo-heading">
                      <h3>
                        Фотографии <span>{ad.photos.length}/12</span>
                      </h3>
                      <span>Анализ фото — по отдельной кнопке</span>
                    </div>
                    <button className="secondary" disabled={!!busy||!serverAI||!ad.photos.length} onClick={()=>guarded(async()=>{
                      const result=await api<{description:string;candidates:Candidate[];questions:string[]}>('analyze',{task:'photos',text:ad.text||'Опиши товар на фотографиях для продажи.',photos:ad.photos.slice(0,3).map(p=>p.dataUrl)});
                      setPhotoSuggestion(result);
                    },'Анализируем фото')}>Предложить описание по фото</button>
                    <p className="fine-print">Первые 3 фото будут отправлены в ИИ через OpenRouter. Результат появится для проверки перед добавлением в карточку.</p>
                    {photoSuggestion&&<div className="panel photo-suggestion"><h3>Проверьте, что распознал ИИ</h3><textarea aria-label="Описание по фото" value={photoSuggestion.description} onChange={e=>setPhotoSuggestion({...photoSuggestion,description:e.target.value})}/>
                      {!!photoSuggestion.questions.length&&<ul>{photoSuggestion.questions.map(q=><li key={q}>{q}</li>)}</ul>}
                      <button className="secondary" onClick={()=>{change(r=>({...r,text:[r.text,photoSuggestion.description].filter(Boolean).join('\n').slice(0,8000)}));setCandidates(photoSuggestion.candidates);if(!categoryId)selectCategory(photoSuggestion.candidates[0]?.id||'');setPhotoSuggestion(null);}}>Описание проверено — добавить</button>
                      <button className="text-button" onClick={()=>setPhotoSuggestion(null)}>Отменить</button>
                    </div>}
                    <input
                      ref={photoInput}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      disabled={!!busy}
                      onChange={(e) => upload(e.target.files)}
                    />
                    <div
                      role="group"
                      aria-label="Фотографии объявления"
                      aria-describedby="photo-paste-hint"
                      tabIndex={0}
                      className={
                        "photo-zone " + (ad.photos.length ? "has-photos" : "")
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        void upload(e.dataTransfer.files);
                      }}
                    >
                      {ad.photos.map((p, i) => (
                        <div className="photo-thumb" key={p.id}>
                          <img src={p.dataUrl} alt={"Фото товара " + (i + 1)} />
                          <button
                            aria-label={"Удалить фото " + (i + 1)}
                            onClick={() =>
                              change((r) => ({
                                ...r,
                                photos: r.photos.filter((x) => x.id !== p.id),
                              }))
                            }
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                      {ad.photos.length < 12 && (
                        <button
                          className="upload-button"
                          disabled={!!busy}
                          onClick={() => photoInput.current?.click()}
                        >
                          <ImagePlus size={24} />
                          <b>Добавить фото</b>
                          <span>JPG, PNG, WebP · до 20 МБ</span>
                        </button>
                      )}
                    </div>
                    <p className="photo-paste-hint" id="photo-paste-hint">
                      Перетащите файлы или нажмите на область фотографий и вставьте
                      изображение из буфера: Ctrl+V (на Mac — ⌘V). До 12 фото.
                    </p>
                  </section>
                  {ad.categoryConfirmed && (
                    <>
                      <section className="panel">
                        <div className="section-title">
                          <div>
                            <span className="section-number">01</span>
                            <h2>Проверьте карточку</h2>
                          </div>
                        </div>
                        <label className="full-label">
                          Заголовок
                          <input
                            value={ad.listing.title}
                            maxLength={120}
                            onChange={(e) => update("title", e.target.value)}
                          />
                        </label>
                        <div className="fields-grid">
                          {definitions.map((f) => (
                            <label key={f.key}>
                              {f.label}
                              {f.options ? (
                                <select
                                  value={ad.listing[f.key]}
                                  onChange={(e) =>
                                    update(f.key, e.target.value)
                                  }
                                >
                                  <option value="">Не указано</option>
                                  {f.options.map((o) => (
                                    <option key={o}>{o}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={ad.listing[f.key]}
                                  placeholder={f.placeholder}
                                  onChange={(e) =>
                                    update(f.key, e.target.value)
                                  }
                                  maxLength={
                                    f.key === "compatibility" ? 500 : 100
                                  }
                                />
                              )}
                            </label>
                          ))}
                        </div>
                        <label className="full-label">
                          Описание для публикации
                          <textarea
                            rows={6}
                            value={ad.listing.description}
                            maxLength={8000}
                            onChange={(e) =>
                              update("description", e.target.value)
                            }
                          />
                        </label>
                        <p className="fine-print">Телефон и город подставляются из «Моего профиля». Здесь их можно изменить только для этой карточки.</p>
                      </section>
                      <CategoryAttributes listing={ad.listing} values={ad.attributes} overrides={ad.categoryOverrides} onChange={attributes=>change(r=>({...r,attributes}))} />
                      <PriceComparison key={ad.id} listing={ad.listing} recordId={ad.id} details={describeAttributes(ad.listing,ad.attributes,ad.categoryOverrides)} ext={ext} serverAI={serverAI} onExtension={()=>setShowExtension(true)} />
                      <section className="panel destinations">
                        <div className="section-title">
                          <div>
                            <span className="section-number">02</span>
                            <h2>Где разместить</h2>
                          </div>
                          <span>{ad.selected.length} выбрано</span>
                        </div>
                        <div className="platform-list">
                          {platforms.map((p) => (
                            <div
                              className={
                                "platform-card " +
                                (ad.selected.includes(p.id) ? "selected" : "")
                              }
                              key={p.id}
                            >
                              <label className="platform-choice">
                                <input
                                  type="checkbox"
                                  checked={ad.selected.includes(p.id)}
                                  onChange={(e) =>
                                    change((r) => ({
                                      ...r,
                                      selected: e.target.checked
                                        ? [...r.selected, p.id]
                                        : r.selected.filter(
                                            (id) => id !== p.id,
                                          ),
                                    }))
                                  }
                                />
                                <span
                                  className="platform-logo"
                                  style={{ background: p.color }}
                                >
                                  {p.short}
                                </span>
                                <span className="platform-info">
                                  <strong>{p.name}</strong>
                                  <small>
                                    {node?.mappings[p.canonicalId]?.path.join(
                                      " → ",
                                    ) || "Категорию нужно уточнить на площадке"}
                                  </small>
                                  <span className="method">{p.tag}</span>
                                </span>
                              </label>
                              <details className="platform-conditions">
                                <summary>Условия</summary>
                                <p>{p.note}</p>
                                <a
                                  href={p.source}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Источник ↗
                                </a>
                              </details>
                            </div>
                          ))}
                        </div>
                      </section>
                    </>
                  )}
                  {ad.jobs.length > 0 && (
                    <section className="panel results">
                      <h2>Задания на размещение</h2>
                      <p className="section-subtitle">
                        Открытая форма и заполненные поля ещё не означают
                        публикацию. Сохраняйте ссылку после подачи.
                      </p>
                      {ad.jobs.map((job) => (
                        <JobCard
                          key={job.platformId}
                          job={job}
                          name={
                            platforms.find((p) => p.id === job.platformId)
                              ?.name || job.platformId
                          }
                          onOpen={() => openJob(job)}
                          onChange={(next) =>
                            change((r) => ({
                              ...r,
                              jobs: r.jobs.map((j) =>
                                j.platformId === next.platformId ? next : j,
                              ),
                            }))
                          }
                        />
                      ))}
                    </section>
                  )}
                </div>
                <aside className="preview-column">
                  <div className="preview-sticky">
                    <div className="preview-label">ПРЕДПРОСМОТР</div>
                    <div className="preview-card">
                      <div className="cover">
                        {ad.photos[0] ? (
                          <img
                            src={ad.photos[0].dataUrl}
                            alt="Обложка объявления"
                          />
                        ) : (
                          <ImagePlus size={70} strokeWidth={1} />
                        )}
                      </div>
                      <div className="preview-body">
                        <h2>{listingTitle(ad.listing) || "Ваш товар"}</h2>
                        <div className="preview-price">
                          {ad.listing.price || "—"}{" "}
                          <span>{ad.listing.currency}</span>
                        </div>
                        <p className="preview-description">
                          {ad.listing.description ||
                            "После выбора категории здесь появится карточка объявления."}
                        </p>
                        <div className="preview-city">
                          {ad.listing.city || "Город продажи"}
                        </div>
                      </div>
                    </div>
                    <div className="extension-card">
                      <b>
                        {ext
                          ? "Помощник подключён"
                          : "Нужно обновить расширение"}
                      </b>
                      <p>
                        Открывает все выбранные площадки. Использует аккаунты, в
                        которые вы вошли в браузере.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setShowExtension(true)}
                      >
                        {ext ? "Инструкция" : "Скачать и установить"} ↗
                      </button>
                    </div>
                    <div className="readiness">
                      <p>
                        Карточка хранится в профиле <b>{profile.name}</b>.
                        Пароли от торговых площадок не нужны Автопосту.
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
              {ad.categoryConfirmed && (
                <Readiness record={ad} connected={ext} onOpen={job=>void openJob(job)} />
              )}
              {ad.categoryConfirmed&&<SellerTemplates record={ad} onApply={change} notify={notify} />}
              {ad.categoryConfirmed&&<Assignee value={ad.assigneeId||''} onChange={assigneeId=>change(r=>({...r,assigneeId}))} notify={notify} />}
              {ad.revision>0&&<History record={ad} onRestored={async()=>{const r=(await api<{ad:AdRecord}>('workspace/ads/'+ad.id)).ad;revisions.current.set(r.id,r.revision);current.current=r;setAd(r);await refresh();}} notify={notify} />}
              {ad.categoryConfirmed && (
                <section className="submit-panel">
                  <div>
                    <PublishModeChoice value={publishMode} onChange={setPublishMode} disabled={!!busy} />
                    <label className="confirm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      <span>
                        Я проверил(а) характеристики, цену, контакты и фото
                      </span>
                    </label>
                    <span className="save-hint">{saveState}</span>
                  </div>
                  <button
                    className="primary big"
                    disabled={!!busy}
                    onClick={start}
                  >
                    {busy || (publishMode==='automatic' ? "Разместить автоматически" : "Создать объявления")}
                    <ArrowRight size={18} />
                  </button>
                </section>
              )}
              {errors.length > 0 && (
                <div className="validation-errors" role="alert">
                  {errors.join(" · ")}
                </div>
              )}
            </>
          )}
          {view === "cabinet" && (
            <Cabinet
              ads={ads}
              onSold={async(record)=>{
                await guarded(async()=>{
                  let stopped=false;
                  if(ext){await extension('CANCEL_RECORD',{profileId:profile.id,recordId:record.id});stopped=true;}
                  const r=(await api<{ad:AdRecord}>('workspace/ads/'+record.id)).ad;
                  await persist({...r,sold:!r.sold});await refresh();
                  notify(r.sold?'Товар возвращён в работу.':`Товар отмечен проданным. ${stopped?'Очередь этого товара остановлена.':'Подключите помощник, чтобы остановить оставшиеся задания в браузере.'} Проверьте снятие на каждой площадке.`);
                },'Сохраняем');
              }}
              onOpenJob={(record, job) => void openJob(job, record)}
              onCheckStatuses={(records) => void checkStatuses(records)}
              pendingChecks={pendingChecks}
              onOpen={openRecord}
              onNew={fresh}
              onRefresh={refresh}
              onLegacy={() =>
                guarded(async () => {
                  const previous = await legacyDrafts();
                  const existing = new Set(ads.map((a) => a.externalId));
                  let imported = 0;
                  for (const record of previous) {
                    if (existing.has(record.externalId)) continue;
                    await persist(record);
                    imported++;
                  }
                  await refresh();
                  notify(
                    imported
                      ? `Перенесено черновиков: ${imported}`
                      : "Новых черновиков старой версии в этом браузере нет.",
                  );
                }, "Переносим черновики")
              }
              onArchive={async (id, archived) => {
                await guarded(async () => {
                  const { ad: r } = await api<{ ad: AdRecord }>(
                    "workspace/ads/" + id,
                  );
                  await persist({ ...r, archived });
                  await refresh();
                }, "Сохраняем");
              }}
            />
          )}
          {view === "taxonomy" && <TaxonomyView />}
          {view === "queue" && <QueueView ads={ads} profileId={profile.id} onOpen={(record,job)=>void openJob(job,record)} onCard={openRecord} notify={notify} paused={queuePaused} onPaused={setQueuePaused} />}
          {view === "edit-many" && <BulkEdit ads={ads} onSaved={refresh} notify={notify} />}
          {view === "team" && <TeamView profileId={profile.id} connected={ext} notify={notify} />}
          {view === "profile" && <Integrations key="profile" mode="profile" onSaved={saveContactDefaults} notify={notify} />}
          {view === "profile" && <SellerTemplates notify={notify} />}
          {view === "integrations" && <Integrations key="integrations" mode="integrations" onSaved={saveContactDefaults} notify={notify} />}
          {view === "bulk" && (
            <Bulk
              profile={profile}
              contacts={contacts}
              ads={ads}
              ext={ext}
              persist={persist}
              refresh={refresh}
              notify={notify}
              openRecord={openRecord}
              launchPayload={launchPayload}
              publishMode={publishMode}
              setPublishMode={setPublishMode}
              onProgress={receive}
            />
          )}
          <footer>
            <Logo />
            <span>MVP 0.8 · {taxonomy.version}</span>
            <button onClick={() => setShowExtension(true)}>
              Помощник для браузера
            </button>
          </footer>
        </main>
      </div>
      {showExtension && (
        <div className="overlay" role="presentation">
          <section
            className="panel extension-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Расширение Автопост"
          >
            <button
              className="dialog-close"
              aria-label="Закрыть"
              onClick={() => setShowExtension(false)}
            >
              <X size={22} />
            </button>
            <h2>Расширение Автопост {EXTENSION_VERSION}</h2>
            <p role="status">{extensionChecking ? "Проверяем подключение…" : extensionStatus}</p>
            <ol className="instructions">
              <li>Скачайте ZIP и распакуйте, заменив файлы старой версии.</li>
              <li>
                В <code>chrome://extensions</code> или{" "}
                <code>edge://extensions</code> включите режим разработчика.
                Загрузите папку или нажмите обновление у установленного
                Автопоста.
              </li>
              <li>
                Обновите страницу Автопоста и уже открытые вкладки площадок.
                Расширение и сайт должны быть открыты в одном браузере и одном профиле браузера. На другом компьютере расширение устанавливается отдельно.
              </li>
              <li>
                Нажмите «Создать объявления». Откроются все выбранные площадки с
                панелью помощника.
              </li>
              <li>
                Войдите при необходимости. Проверьте заполнение, завершите
                подачу в обычном режиме. Автоматический режим отправляет готовую карточку на поддерживаемых формах. Помощник сохранит распознанную ссылку; запасной способ — кнопка в панели.
              </li>
            </ol>
            <p className="fine-print">
              CAPTCHA и платные услуги требуют вашего действия. ABW требует
              разрешения на автоматизацию. Закрытые формы Bamper и Onlíner
              нуждаются в проверке после входа.
            </p>
            <div className="modal-actions">
              <a className="primary" href={`/autopost-extension.zip?v=${EXTENSION_VERSION}`} download>
                <Download size={17} />
                Скачать ZIP
              </a>
              <button
                className="secondary"
                disabled={extensionChecking}
                onClick={() => void checkExtension(true)}
              >
                {extensionChecking ? "Проверяем…" : "Проверить подключение"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  name,
  onOpen,
  onChange,
}: {
  job: Job;
  name: string;
  onOpen: () => void;
  onChange: (j: Job) => void;
}) {
  const [url, setUrl] = useState(job.url || ""),
    [error, setError] = useState("");
  useEffect(() => setUrl(job.url || ""), [job.url]);
  return (
    <div className="job">
      <div className="job-top">
        <b>{name}</b>
        <span className="job-status">
          {statusLabel[job.status] || job.status}
        </span>
      </div>
      <p>{job.message}</p>
      <div className="job-actions">
        <button className="text-button" onClick={onOpen}>
          Открыть с помощником
          <ExternalLink size={13} />
        </button>
        {job.url && (
          <a href={job.url} target="_blank" rel="noreferrer">
            Перейти к объявлению ↗
          </a>
        )}
      </div>
      <details>
        <summary>Ссылка и отметка о состоянии</summary>
        <label className="full-label">
          Ссылка на объявление
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="job-actions">
          <button
            className="secondary"
            onClick={() => {
              const safe = safePublicationUrl(job.platformId, url);
              if (!safe) {
                setError("Укажите HTTPS-ссылку этой площадки.");
                return;
              }
              setError("");
              onChange({
                ...job,
                url: safe,
                remoteStatus: safe === job.url ? job.remoteStatus : undefined,
                status: "link_recorded",
                message:
                  "Ссылка добавлена пользователем. Статус площадки ещё не проверен.",
              });
            }}
          >
            Сохранить ссылку
          </button>
          {job.url && (
            <button
              className="text-button"
              onClick={() =>
                onChange({
                  ...job,
                  status: "inactive",
                  message:
                    "Пользователь отметил объявление неактивным. На самой площадке изменений не выполнялось.",
                })
              }
            >
              Отметить неактивным в кабинете
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
function Cabinet({
  ads,
  onSold,
  onOpen,
  onOpenJob,
  onCheckStatuses,
  pendingChecks,
  onNew,
  onRefresh,
  onLegacy,
  onArchive,
}: {
  ads: AdSummary[];
  onSold:(ad:AdSummary)=>Promise<void>;
  onOpen: (id: string) => void;
  onOpenJob: (record: AdSummary, job: Job) => void;
  onCheckStatuses: (records: AdSummary[]) => void;
  pendingChecks: number;
  onNew: () => void;
  onRefresh: () => Promise<void>;
  onLegacy: () => Promise<void>;
  onArchive: (id: string, archived: boolean) => void;
}) {
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const filtered = ads.filter(
    (a) =>
      a.archived === archived &&
      `${a.listing.title} ${a.listing.partNumber}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="heading-row">
        <div>
          <h1>Мои объявления</h1>
          <p className="subtitle">Карточки, задания и ссылки на площадки.</p>
        </div>
        <button className="primary" onClick={onNew}>
          <Plus size={17} />
          Создать
        </button>
      </div>
      <div className="cabinet-stats">
        <div>
          <b>{ads.filter((a) => !a.archived).length}</b>
          <span>Карточек в работе</span>
        </div>
        <div>
          <b>{ads.flatMap((a) => a.jobs).filter((j) => j.url).length}</b>
          <span>Сохранённых ссылок</span>
        </div>
        <div>
          <b>
            {
              ads
                .flatMap((a) => a.jobs)
                .filter((j) =>
                  [
                    "queued",
                    "opening",
                    "auto_checking",
                    "submitting",
                    "authorization_required",
                    "captcha_required",
                    "review_required",
                    "manual_required",
                    "category_required",
                    "error",
                  ].includes(j.status),
                ).length
            }
          </b>
          <span>Незавершённых заданий</span>
        </div>
      </div>
      <div className="table-toolbar">
        <label>
          <Search size={17} />
          <input
            aria-label="Поиск объявлений"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название или артикул"
          />
        </label>
        <button className="secondary" onClick={() => setArchived(!archived)}>
          {archived ? "В работе" : "Архив"}
        </button>
        <button className="text-button" onClick={() => void onRefresh()}>
          Обновить список
        </button>
        <button className="secondary" disabled={pendingChecks>0 || !ads.some(a=>!a.archived && a.jobs.some(j=>j.url && j.status!=="inactive"))}
          onClick={()=>onCheckStatuses(ads.filter(a=>!a.archived).map(a=>({...a,jobs:a.jobs.filter(j=>j.status!=="inactive")})))}>
          {pendingChecks ? `Проверяем статусы (${pendingChecks})…` : "Обновить статусы всех активных"}
        </button>
        <button className="text-button" onClick={() => void onLegacy()}>
          Перенести старые черновики
        </button>
      </div>
      <div className="listing-records">
        {!filtered.length && (
          <div className="panel empty-state">
            <ClipboardList size={40} />
            <h3>Пока нет объявлений</h3>
            <p>Создайте карточку или импортируйте таблицу.</p>
          </div>
        )}
        {filtered.map((a) => (
          <article className="panel listing-entry" key={a.id}>
            <div>
              <span className="soft-badge">
                {a.sold?'Продано · ':''}
                {categoryById(a.listing.taxonomyId)?.name ||
                  "Категория не выбрана"}
              </span>
              <h2>
                <button onClick={() => onOpen(a.id)}>
                  {listingTitle(a.listing) || "Новая карточка"}
                </button>
              </h2>
              <p>
                {a.listing.price} {a.listing.currency} · {a.photoCount} фото ·{" "}
                {new Date(a.updatedAt).toLocaleString("ru-RU")}
              </p>
            </div>
            <div className="listing-channel-statuses">
              {a.jobs.map((j) => {
                const name = getPlatforms(a.listing.category, a.listing.taxonomyId)
                  .find((p) => p.id === j.platformId)?.name || j.platformId;
                const label = `${name}: ${j.url && j.remoteStatus && j.status!=="inactive" ? remoteStatusLabel[j.remoteStatus.state] : statusLabel[j.status]}`;
                return j.url ? (
                  <a key={j.platformId} className="listing-channel-link" href={j.url} target="_blank" rel="noreferrer" title={j.remoteStatus ? `${j.remoteStatus.message} Проверено: ${new Date(j.remoteStatus.checkedAt).toLocaleString('ru-RU')}` : j.message}>
                    {label} ↗
                  </a>
                ) : (
                  <button key={j.platformId} type="button" className="listing-channel-link" onClick={() => onOpenJob(a, j)}
                    title={`Открыть задание на ${name}. ${j.message}`} aria-label={`${label}. Открыть задание`}>
                    {label} ↗
                  </button>
                );
              })}
            </div>
            {a.jobs.some(j=>j.remoteStatus) && <div className="listing-status-details">{a.jobs.filter(j=>j.remoteStatus).map(j=><p key={j.platformId}>
              <b>{getPlatforms(a.listing.category,a.listing.taxonomyId).find(p=>p.id===j.platformId)?.name}: </b>
              {j.remoteStatus!.message} <small>Проверено {new Date(j.remoteStatus!.checkedAt).toLocaleString('ru-RU')}</small>
            </p>)}</div>}
            <div className="job-actions">
              <button className="secondary" onClick={()=>void onSold(a)}>{a.sold?'Вернуть товар в продажу':'Товар продан'}</button>
              <button className="primary" onClick={() => onOpen(a.id)}>
                Открыть карточку
              </button>
              <button className="secondary" disabled={pendingChecks>0 || !a.jobs.some(j=>j.url)}
                title={a.jobs.some(j=>j.url)?"Проверить площадки по сохранённым ссылкам":"Проверка доступна после сохранения ссылки"}
                onClick={()=>onCheckStatuses([a])}>Обновить статусы</button>
              <button
                className="text-button"
                onClick={() => onArchive(a.id, !a.archived)}
              >
                {a.archived ? "Вернуть в работу" : "В архив кабинета"}
              </button>
            </div>
            {a.sold&&<div className="sold-results"><b>Снятие с площадок</b>{a.jobs.map(j=><p key={j.platformId}>{getPlatforms(a.listing.category,a.listing.taxonomyId).find(p=>p.id===j.platformId)?.name}: {j.remoteStatus?.state==='inactive'?'Проверка показала неактивное объявление':j.status==='cancelled'&&!j.url?'Подача отменена':j.url?<><a href={j.url} target="_blank" rel="noreferrer">Откройте объявление и снимите с продажи ↗</a>. Автоматическое снятие не подключено.</>:'Ссылка неизвестна. Проверьте кабинет площадки.'}</p>)}<p>После снятия нажмите «Обновить статусы». Автопост не считает закрытое объявление подтверждённой продажей.</p></div>}
          </article>
        ))}
      </div>
      <p className="fine-print">
        Архивирование и отметки в Автопосте не удаляют объявления на площадках.
        Проверка читает видимый ответ площадки по сохранённой ссылке. «Открывается» не означает подтверждения модерации.
        Если площадка скрывает причину или требует входа, откройте её по ссылке. Поднятие и снятие с продажи не подключены.
      </p>
    </>
  );
}
function TaxonomyView() {
  const [search, setSearch] = useState("");
  const filtered = categories.filter((c) =>
    `${c.parent} ${c.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <h1>Справочник категорий</h1>
      <p className="subtitle">
        {categories.length} категорий · {taxonomy.directories.kufar.length}{" "}
        узлов Куфар · {taxonomy.directories.onliner.length} разделов Onlíner · {mappingOptions("flagma").length} подразделов Flagma
      </p>
      <p className="callout">{taxonomy.coverage}</p>
      <label className="full-label">
        Поиск
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Название категории"
        />
      </label>
      <div className="taxonomy-list">
        {filtered.slice(0, 100).map((c) => (
          <div className="panel" key={c.id}>
            <b>
              {c.parent} / {c.name}
            </b>
            <div className="taxonomy-mappings">
              {Object.entries(c.mappings).map(([p, m]) => (
                <span key={p}>
                  <strong>{p}</strong> {mappingLabel(m)}{" "}
                  <small>
                    {m.verified ? "Источник проверен" : "Требуется уточнение"}
                  </small>{" "}
                  <a
                    href={taxonomy.sources[m.source]}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ↗
                  </a>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {filtered.length > 100 && (
        <p>Показаны первые 100 результатов. Уточните поиск.</p>
      )}
    </>
  );
}
function Integrations({ notify, mode, onSaved }: { notify: (s: string) => void; mode: "profile" | "integrations"; onSaved: (value: SellerContacts) => void }) {
  const [settings, setSettings] = useState({
      company: "",
      contactPerson: "",
      phone: "",
      city: "",
      integrations: {} as Record<string, { enabled: boolean; notes: string }>,
    }),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api<{ settings: typeof settings }>("workspace/settings")
      .then((r) => { setSettings((s) => ({ ...s, ...r.settings })); setLoaded(true); })
      .catch((e) => notify(errorText(e)));
  }, []);
  return (
    <>
      <h1>{mode === "profile" ? "Мой профиль" : "Интеграции"}</h1>
      <p className="subtitle">
        {mode === "profile" ? "Контакты для новых объявлений. Сохранённые карточки не изменятся." : "Официальные импорты подключаются к вашему аккаунту на площадке."}
      </p>
      {mode === "profile" && <div className="panel integration-profile">
        <div className="fields-grid">
          {[
            ["company", "Компания"],
            ["contactPerson", "Контактное лицо"],
            ["phone", "Телефон"],
            ["city", "Город"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                maxLength={key === "phone" ? 40 : 100}
                disabled={!loaded}
                type={key === "phone" ? "tel" : "text"}
                placeholder={key === "phone" ? "+375291234567" : key === "city" ? "Минск" : ""}
                value={String(settings[key as keyof typeof settings] || "")}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
      </div>}
      {mode === "integrations" && [
        {
          id: "kufar",
          name: "Куфар · KML",
          url: "https://import-docs.kufar.by/import_documentation_revision_5.html",
          text: "Импорт по постоянной ссылке, обновление раз в сутки. Нужны подключение партнёра, точные коды параметров и доступные URL фотографий. В этой версии фид не активирован.",
        },
        {
          id: "bamper",
          name: "Bamper · Excel / CSV",
          url: "https://bamper.by/contacts/",
          text: "Ночная синхронизация CSV по ссылке доступна юрлицам и ИП. Схема файла и настройка находятся в аккаунте Bamper. Без доступа к схеме файл не выдаётся за готовый импорт.",
        },
        {
          id: "flagma",
          name: "Flagma · XLSX / YML / XML",
          url: "https://flagma.by/import",
          text: "В массовой загрузке доступен экспорт XLSX по официальным колонкам. Нужен точный конечный подраздел. Файл создаёт неактивные объявления для проверки в кабинете площадки.",
        },
      ].map((p) => (
        <section className="panel integration-card" key={p.id}>
          <h2>{p.name}</h2>
          <p>{p.text}</p>
          <a
            className="text-button"
            href={p.url}
            target="_blank"
            rel="noreferrer"
          >
            Условия площадки <ExternalLink size={14} />
          </a>
          <label className="confirm">
            <input
              type="checkbox"
              checked={settings.integrations[p.id]?.enabled || false}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  integrations: {
                    ...s.integrations,
                    [p.id]: {
                      ...s.integrations[p.id],
                      enabled: e.target.checked,
                    },
                  },
                }))
              }
            />
            У меня подключён официальный импорт на этой площадке
          </label>
          <label className="full-label">
            Заметка о подключении
            <input
              value={settings.integrations[p.id]?.notes || ""}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  integrations: {
                    ...s.integrations,
                    [p.id]: { ...s.integrations[p.id], notes: e.target.value },
                  },
                }))
              }
              placeholder="Статус обращения, ограничения, формат. Без паролей и ключей."
            />
          </label>
        </section>
      ))}
      <button
        className="primary"
        disabled={busy || !loaded}
        onClick={async () => {
          setBusy(true);
          try {
            const response = await api<{settings: typeof settings}>("workspace/settings", mode === "profile" ? {phone:settings.phone,city:settings.city,company:settings.company,contactPerson:settings.contactPerson} : {integrations:settings.integrations});
            onSaved(response.settings);
            notify(
              mode === "profile" ? "Контакты сохранены. Они будут подставляться в новые карточки." : "Настройки сохранены. Отметка не активирует интеграцию автоматически.",
            );
          } catch (e) {
            notify(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Сохранить настройки
      </button>
      <p className="fine-print">
        Для поштучной очереди используется расширение и текущая авторизация
        сайтов в браузере. Работа без открытого браузера и операции с платным
        продвижением не подключены.
      </p>
    </>
  );
}

type PublishMode = 'manual' | 'automatic';
function PublishModeChoice({value,onChange,disabled=false}: {value:PublishMode;onChange:(mode:PublishMode)=>void;disabled?:boolean}) {
  return <fieldset className="publish-mode" disabled={disabled}>
    <legend>Режим подачи</legend>
    <label className="confirm"><input type="radio" name="publish-mode" value="manual" checked={value==='manual'} onChange={()=>onChange('manual')} />С подтверждением на площадке</label>
    <label className="confirm"><input type="radio" name="publish-mode" value="automatic" checked={value==='automatic'} onChange={()=>onChange('automatic')} />Автоматически в фоне · beta</label>
    <p className="fine-print">{value==='automatic'
      ? 'Запуск разрешает отправку готовых карточек без отдельного клика на площадке. Поддерживаются Kufar и Барахолка Onlíner. Другие формы, ошибки, капча и платные действия требуют вашего участия. На Kufar выбирается вариант без продвижения. Оставьте браузер и вкладку Автопоста открытыми: перед отправкой проверяется актуальная карточка.'
      : 'Помощник заполняет формы. Вы проверяете каждое объявление и нажимаете кнопку подачи на площадке.'}</p>
  </fieldset>;
}

function Bulk({
  profile,
  contacts,
  ads,
  ext,
  persist,
  refresh,
  notify,
  openRecord,
  launchPayload,
  publishMode,
  setPublishMode,
  onProgress,
}: {
  profile: Profile;
  contacts: SellerContacts;
  ads: AdSummary[];
  ext: boolean;
  persist: (r: AdRecord) => Promise<AdRecord>;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  openRecord: (id: string) => void;
  launchPayload: (r: AdRecord) => unknown;
  publishMode: PublishMode;
  setPublishMode: (mode: PublishMode) => void;
  onProgress: (b: {
    batchId: string;
    recordId: string;
    jobs: Job[];
  }) => Promise<void>;
}) {
  const [table, setTable] = useState<ImportTable | null>(null),
    [columns, setColumns] = useState<Record<string, string>>({}),
    [override, setOverride] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [flagmaCategory, setFlagmaCategory] = useState("");
  const [preparedQueue, setPreparedQueue] = useState<AdRecord[]>([]);
  const [importPhotos, setImportPhotos] = useState<File[]>([]);
  const [presets,setPresets]=useState<ImportPreset[]>([]);
  const [sourceId,setSourceId]=useState('main');
  const [sourceName,setSourceName]=useState('Основной каталог');
  const [feedUrl,setFeedUrl]=useState('');
  useEffect(()=>{void api<{settings:{importPresets?:ImportPreset[]}}>('workspace/settings').then(r=>setPresets(r.settings.importPresets||[])).catch(e=>notify(errorText(e)));},[]);
  function acceptTable(next:ImportTable){setTable(next);const preset=presets.find(p=>p.id===sourceId);setColumns(Object.fromEntries(next.headers.map(h=>[h,preset?.columns[h]||guessColumns(next.headers)[h]||''])));setConfirmed(false);}
  useEffect(() => setPreparedQueue([]), [selected]);
  const preview = useMemo(
    () => (table ? normalizeImport(table, columns, override, contacts) : []),
    [table, columns, override, contacts],
  );
  const valid = preview.filter((p) => !p.duplicate);
  async function work(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function loadSelected() {
    const result = [];
    for (const id of selected)
      result.push((await api<{ ad: AdRecord }>("workspace/ads/" + id)).ad);
    return result;
  }
  return (
    <>
      <div className="heading-row">
        <div>
          <h1>Массовая загрузка</h1>
          <p className="subtitle">
            Импортируйте таблицу, проверьте карточки и запустите очередь.
          </p>
        </div>
        <button
          className="secondary"
          onClick={() =>
            download(
              "шаблон-объявлений.csv",
              "\uFEFFexternalId;taxonomyId;title;description;price;currency;city;phone;partName;partNumber;condition;priceUnit;photos\r\n",
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={16} />
          Шаблон CSV
        </button>
      </div>
      <section className="panel">
        <h2>1. Загрузите выгрузку</h2>
        <p className="section-subtitle">
          XLSX, CSV, TSV, JSON, YML · до 500 строк и 5 МБ. Названия колонок можно
          сопоставить вручную.
        </p>
        <input
          type="file"
          aria-label="Файл с объявлениями"
          accept=".xlsx,.csv,.tsv,.txt,.json,.xml,.yml"
          disabled={!!busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void work("Читаем файл", async () => {
                const next = await readImport(file);
                acceptTable(next);
              });
            e.target.value = "";
          }}
        />
        <div className="fields-grid">
          <label>Источник каталога<select aria-label="Источник каталога" value={sourceId} onChange={e=>{setSourceId(e.target.value);const p=presets.find(p=>p.id===e.target.value);setSourceName(p?.name||'Основной каталог');setFeedUrl(p?.url||'');setOverride(p?.categoryId||'');if(table)setColumns(p?.columns||guessColumns(table.headers));setConfirmed(false);}}>
            <option value="main">Основной каталог</option>{presets.filter(p=>p.id!=='main').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label>Название источника<input value={sourceName} onChange={e=>setSourceName(e.target.value)} maxLength={80}/></label>
        </div>
        <button className="text-button" onClick={()=>{const id=crypto.randomUUID();setSourceId(id);setSourceName('Новый каталог');setPresets(p=>[...p,{id,name:'Новый каталог',columns:{},categoryId:'',url:''}]);setConfirmed(false);}}>Добавить другой источник</button>
        <label className="full-label">HTTPS-ссылка на YML<input aria-label="Ссылка на YML" type="url" value={feedUrl} onChange={e=>setFeedUrl(e.target.value)} placeholder="https://shop.example/catalog.xml" /></label>
        <button className="secondary" disabled={!!busy||!feedUrl} onClick={()=>work('Загружаем каталог',async()=>{const {text}=await api<{text:string}>('workspace/feed',{url:feedUrl});acceptTable(await readImport(new File([text],'catalog.yml')));})}>Загрузить по ссылке</button>
        <p className="fine-print">Для повторных выгрузок выбирайте тот же источник. Совпавшие externalId обновят существующие карточки. Пустые ячейки не стирают данные; отсутствующие строки не удаляют товары. Без externalId обновление цены создаст новую карточку.</p>
        {table && (
          <>
            <div className="column-mapping">
              {table.headers.map((h) => (
                <label key={h}>
                  {h}
                  <select
                    value={columns[h] || ""}
                    onChange={(e) =>
                      setColumns((c) => ({ ...c, [h]: e.target.value }))
                    }
                  >
                    <option value="">Не импортировать</option>
                    {importFields.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <CategorySelect value={override} onChange={setOverride} />
            <button className="secondary" disabled={!!busy||!sourceName.trim()} onClick={()=>work('Сохраняем настройки',async()=>{const next=[...presets.filter(p=>p.id!==sourceId),{id:sourceId,name:sourceName,columns,categoryId:override,url:feedUrl}];await api('workspace/settings',{importPresets:next});setPresets(next);notify('Сопоставление сохранено для следующей выгрузки.');})}>Сохранить настройки источника</button>
            <p className="fine-print">
              Категория выше применяется ко всему файлу. Оставьте пустой для
              смешанного ассортимента: категории из taxonomyId сохранятся,
              предложения по тексту потребуют подтверждения в карточке.
            </p>
            <div className="import-preview">
              <table>
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Товар</th>
                    <th>Категория</th>
                    <th>Проверка</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 30).map((p) => (
                    <tr key={p.sourceRow}>
                      <td>{p.sourceRow}</td>
                      <td>
                        {p.record.listing.title ||
                          p.record.listing.partName ||
                          "Без названия"}
                      </td>
                      <td>
                        {categoryById(p.record.listing.taxonomyId)?.name ||
                          "Не определена"}
                      </td>
                      <td>
                        <b>{ads.some(a=>a.sourceId===sourceId&&p.record.externalId&&a.externalId===p.record.externalId)?'Обновление существующей карточки. ':'Новая карточка. '}</b>
                        {p.errors.join(", ") || "Основные поля заполнены"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {table.rows.length} строк ·{" "}
              {preview.filter((p) => p.duplicate).length} повторов будут
              пропущены. Фото добавляются в карточке.
            </p>
            <label className="full-label">
              Фотографии к выгрузке
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                disabled={!!busy}
                onChange={(e) =>
                  setImportPhotos(Array.from(e.target.files || []))
                }
              />
            </label>
            <p className="fine-print">
              В колонке photos перечислите имена файлов через |. Или назовите
              фотографии по externalId: A001_1.jpg, A001_2.jpg. Выберите все
              файлы сразу. Сопоставлено фото:{" "}
              {valid.reduce(
                (n, p) => n + matchingPhotos(p.record, importPhotos).length,
                0,
              )}
              . Ссылки из таблицы сохраняются для официальной выгрузки; для
              заполнения через расширение нужны файлы.
            </p>
            <label className="confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Я проверил(а) сопоставление колонок и состав файла
            </label>
            <button
              className="primary"
              disabled={!confirmed || !!busy}
              onClick={() =>
                work("Сохраняем карточки", async () => {
                  let count = 0;
                  let updated=0;
                  for (const item of valid) {
                    const photos: Photo[] = [];
                    for (const file of matchingPhotos(
                      item.record,
                      importPhotos,
                    ))
                      photos.push(await optimizePhoto(file));
                    const previous=ads.find(a=>a.sourceId===sourceId&&item.record.externalId&&a.externalId===item.record.externalId);
                    const nonemptyFields=Object.entries(columns).filter(([header,target])=>target && table!.rows[item.sourceRow-2]?.[header]?.trim()).map(([,target])=>target);
                    const result=await api<{action:string}>('workspace/import',{sourceId,record:{...item.record,photos},fields:nonemptyFields,expectedRevision:previous?.revision});
                    if(result.action==='updated')updated++;
                    count++;
                    setBusy("Сохранено " + count + " из " + valid.length);
                  }
                  await refresh();
                  setTable(null);
                  setImportPhotos([]);
                  notify(
                    "Обработано карточек: " +
                      count + '. Обновлено: '+updated+
                      ". Проверьте карточки перед запуском очереди.",
                  );
                })
              }
            >
              {busy || "Импортировать в личный кабинет"}
            </button>
          </>
        )}
      </section>
      <section className="panel bulk-queue">
        <h2>2. Выберите карточки для очереди</h2>
        <PublishModeChoice value={publishMode} onChange={setPublishMode} disabled={!!busy} />
        <p className="section-subtitle">
          До 20 за запуск. Одна активная карточка на площадку; после сохранения
          ссылки или пропуска открывается следующая. Браузер должен оставаться
          открытым.
        </p>
        {ads
          .filter((a) => !a.archived&&!a.sold)
          .map((a) => (
            <div className="bulk-row" key={a.id}>
              <label className="confirm">
                <input
                  type="checkbox"
                  checked={selected.includes(a.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, a.id]
                        : ids.filter((id) => id !== a.id),
                    )
                  }
                />
                <span>
                  {listingTitle(a.listing) || "Новая карточка"}
                  <small>
                    {a.photoCount} фото · {a.selected.length} площадки ·{" "}
                    {a.categoryConfirmed
                      ? "Категория подтверждена"
                      : "Проверьте категорию"}
                  </small>
                </span>
              </label>
              <button className="text-button" onClick={() => openRecord(a.id)}>
                Редактировать
              </button>
            </div>
          ))}
        <div className="job-actions">
          <button
            className="primary"
            disabled={!selected.length || selected.length > 20 || !!busy}
            onClick={() =>
              work("Проверяем очередь", async () => {
                if (!ext) throw new Error(`Подключите расширение ${EXTENSION_VERSION}.`);
                const records = (await loadSelected()).map(r=>({...r,selected:availablePlatforms(r)}));
                const problems = records.flatMap((r) => {
                  const e = [
                    ...validateListing(r.listing),
                    ...platformValidation(r.listing, r.selected, r.categoryOverrides),
                    ...(!r.categoryConfirmed
                      ? ["категория не подтверждена"]
                      : []),
                    ...(r.sold||r.listing.availability==='Нет в наличии'||r.listing.quantity==='0'?['товар продан или отсутствует']:[]),
                    ...(!r.photos.length ? ["нет фото"] : []),
                    ...(!r.selected.length ? ["нет новых площадок: существующие задания доступны в очереди"] : []),
                  ];
                  return e.length
                    ? [listingTitle(r.listing) + ": " + e.join(", ")]
                    : [];
                });
                if (problems.length)
                  throw new Error(problems.slice(0, 5).join(" · "));
                const items = records.map((r) => {const batchId=crypto.randomUUID();return ({
                  ...r,
                  batchId,
                  jobs: [...r.jobs.filter(j=>!r.selected.includes(j.platformId)).map(j=>({...j,batchId:j.batchId||r.batchId})),...r.selected.map((platformId) => ({
                    batchId,
                    platformId,
                    status: "ready",
                    message:
                      "Проверено. Ожидает запуска очереди пользователем.",
                  }))],
                });});
                for (const item of items) await persist(item);
                setPreparedQueue(items);
                notify(
                  "Карточки проверены. Нажмите «Запустить подготовленную очередь».",
                );
              })
            }
          >
            {busy || "Проверить выбранные карточки"}
          </button>
          {preparedQueue.length > 0 && (
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                work("Открываем площадки", async () => {
                  const result = await extension(
                    "RUN_QUEUE",
                    {
                      profileId: profile.id,
                      items: preparedQueue.map(launchPayload),
                    },
                    30000,
                  );
                  if (Array.isArray(result.batches))
                    for (const b of result.batches) await onProgress(b);
                  setPreparedQueue([]);
                  notify(
                    "Очередь запущена. Статусы и ссылки сохраняются в личном кабинете.",
                  );
                })
              }
            >
              {publishMode==='automatic' ? 'Разместить автоматически' : 'Запустить подготовленную очередь'} ({preparedQueue.length})
            </button>
          )}
          <button
            className="secondary"
            disabled={!!busy}
            onClick={() => extension('SET_MODE',{profileId:profile.id,publishMode})
              .then(()=>notify('Режим применён к оставшимся заданиям. Уже отправленные объявления не отправляются повторно.'))
              .catch(e=>notify(errorText(e)))}
          >Применить режим к запущенной очереди</button>
          <button
            className="secondary"
            onClick={() =>
              extension("PAUSE", { profileId: profile.id })
                .then(() => notify("Очередь приостановлена."))
                .catch((e) => notify(errorText(e)))
            }
          >
            Пауза
          </button>
          <button
            className="secondary"
            onClick={() =>
              extension("RESUME", { profileId: profile.id })
                .then(() => notify("Очередь продолжена."))
                .catch((e) => notify(errorText(e)))
            }
          >
            Продолжить
          </button>
        </div>
        <div className="job-actions">
          <button
            className="text-button"
            disabled={!selected.length}
            onClick={() =>
              work("Готовим экспорт", async () =>
                download(
                  "объявления.csv",
                  csvExport(await loadSelected()),
                  "text/csv;charset=utf-8",
                ),
              )
            }
          >
            Экспорт выбранных в CSV
          </button>
          <button
            className="text-button"
            onClick={() =>
              extension("CLEAR", { profileId: profile.id })
                .then(() =>
                  notify("Сеансы расширения очищены. Карточки сохранены."),
                )
                .catch((e) => notify(errorText(e)))
            }
          >
            Очистить сеансы расширения
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>3. Официальный импорт Flagma</h2>
        <p className="section-subtitle">
          Выбранные карточки будут сохранены в XLSX с официальными колонками.
          Импорт создаёт неактивные объявления для проверки. Если в таблице
          указана публичная HTTPS-ссылка на фото, первое фото включается в файл.
          Активация выполняется на площадке.
        </p>
        <label className="full-label">
          Переопределить подраздел Flagma для всей выгрузки (необязательно)
          <input
            value={flagmaCategory}
            onChange={(e) => setFlagmaCategory(e.target.value)}
            placeholder="По умолчанию — категория каждой карточки"
          />
        </label>
        <p className="fine-print">
          Категория подставляется из настроек каждой карточки на шаге 0. Это поле
          используйте только для общего подраздела всей выгрузки.
        </p>
        <div className="job-actions">
          <button
            className="primary"
            disabled={!selected.length || !!busy}
            onClick={() =>
              work("Готовим XLSX", async () => {
                const records = await loadSelected();
                const bytes = await flagmaXlsx(
                  records,
                  Object.fromEntries(
                    records.map((r) => [r.id, flagmaCategory]),
                  ),
                );
                download(
                  "flagma-объявления.xlsx",
                  bytes as BlobPart,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                );
              })
            }
          >
            <Download size={16} />
            Скачать XLSX для Flagma
          </button>
          <a
            className="secondary"
            href="https://flagma.by/import"
            target="_blank"
            rel="noreferrer"
          >
            Открыть официальный импорт ↗
          </a>
        </div>
        <p className="fine-print">
          Файл не отправляется без авторизации площадки. Подключение
          KML/CSV-фидов Kufar и Bamper описано в разделе «Интеграции».
        </p>
      </section>
    </>
  );
}
