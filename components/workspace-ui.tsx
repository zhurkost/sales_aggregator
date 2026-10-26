"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { legacyDrafts } from "../lib/legacy";
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
  type Candidate,
} from "../lib/taxonomy";
import {
  defaultPlatforms,
  getPlatforms,
  platformValidation,
  safePublicationUrl,
  statusLabel,
  type Job,
} from "../lib/platforms";
import {
  api,
  download,
  extension,
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
        Категория товара
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
    [ext, setExt] = useState(false),
    [serverAI, setServerAI] = useState(false),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [categoryId, setCategoryId] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [showExtension, setShowExtension] = useState(false);
  const current = useRef(ad),
    revisions = useRef(new Map<string, number>()),
    saveQueue = useRef(Promise.resolve()),
    progressQueue = useRef(Promise.resolve()),
    alive = useRef(true),
    seenProgress = useRef(new Map<string, string>()),
    photoInput = useRef<HTMLInputElement>(null);
  function change(next: AdRecord | ((r: AdRecord) => AdRecord)) {
    const value = typeof next === "function" ? next(current.current) : next;
    current.current = value;
    setAd(value);
    setDirty((n) => n + 1);
    setSaveState("Есть несохранённые изменения");
    setChecked(false);
  }
  async function refresh() {
    const result = await api<{ ads: AdSummary[] }>("workspace/ads");
    if (alive.current) setAds(result.ads);
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
        if (current.current.id === snapshot.id) {
          current.current = {
            ...current.current,
            revision: r.ad.revision,
            updatedAt: r.ad.updatedAt,
            events: r.ad.events,
          };
          setAd(current.current);
        }
        if (current.current.id === snapshot.id)
          setSaveState(
            current.current.listing === snapshot.listing &&
              current.current.text === snapshot.text &&
              current.current.photos === snapshot.photos &&
              current.current.jobs === snapshot.jobs &&
              current.current.selected === snapshot.selected &&
              current.current.categoryConfirmed === snapshot.categoryConfirmed &&
              current.current.prepared === snapshot.prepared &&
              current.current.archived === snapshot.archived &&
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
  }) {
    if (batch.profileId && batch.profileId !== profile.id) return;
    if (!batch.recordId || !Array.isArray(batch.jobs)) return;
    const signature = JSON.stringify(batch.jobs);
    if (seenProgress.current.get(batch.batchId) === signature) return;
    let record =
      current.current.id === batch.recordId
        ? current.current
        : (await api<{ ad: AdRecord }>("workspace/ads/" + batch.recordId)).ad;
    if (record.batchId !== batch.batchId) return;
    record = {
      ...record,
      jobs: record.jobs.map(
        (job) => batch.jobs.find((j) => j.platformId === job.platformId) || job,
      ),
    };
    if (current.current.id === record.id) {
      current.current = record;
      setAd(record);
    }
    await persist(record);
    seenProgress.current.set(batch.batchId, signature);
  }
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => notify(errorText(e)));
    extension("PING", undefined, 1800)
      .then((r) =>
        setExt(
          typeof r.version === "string" &&
            r.version.split(".").map(Number)[1] >= 3,
        ),
      )
      .catch(() => {});
    api<{ serverConfigured: boolean }>("ai-settings")
      .then((r) => setServerAI(r.serverConfigured))
      .catch(() => {});
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.source !== "autopost-extension" ||
        event.data.type !== "PROGRESS"
      )
        return;
      progressQueue.current = progressQueue.current
        .then(() => receive(event.data.payload))
        .catch((e) => notify(errorText(e)));
    };
    window.addEventListener("message", listener);
    const timer = setInterval(
      () =>
        extension("STATUS", { profileId: profile.id }, 3000)
          .then((r) => {
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
      clearInterval(timer);
      window.removeEventListener("message", listener);
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
      setCandidates([]);
      setChecked(false);
      setErrors([]);
      setView("editor");
    }, "Открываем");
  }
  async function fresh() {
    await guarded(async () => {
      if (dirty) await persist();
      const value = newRecord({ ...emptyListing });
      current.current = value;
      setAd(value);
      setDirty(0);
      setCategoryId("");
      setCandidates([]);
      setErrors([]);
      setChecked(false);
      setView("editor");
    }, "Сохраняем");
  }
  async function classify() {
    await guarded(async () => {
      if (current.current.text.trim().length < 15)
        throw new Error("Опишите товар хотя бы в 15 символах.");
      if (serverAI) {
        const r = await api<{ candidates: Candidate[]; question?: string }>(
          "analyze",
          { task: "classify", text: current.current.text },
        );
        setCandidates(r.candidates);
        setCategoryId(r.candidates[0]?.id || "");
        if (r.question) notify(r.question);
      } else {
        const result = suggestCategories(current.current.text);
        setCandidates(result);
        setCategoryId(result[0]?.id || "");
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
      listing.taxonomyId = id;
      change({
        ...source,
        listing,
        categoryConfirmed: true,
        prepared: true,
        selected: defaultPlatforms(category.group, id),
        jobs: [],
        batchId: "",
      });
      await persist();
      notify("Карточка подготовлена. Проверьте характеристики и контакты.");
    }, "Готовим карточку");
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    await guarded(async () => {
      const available = 12 - current.current.photos.length;
      const photos: Photo[] = [];
      for (const f of Array.from(files).slice(0, available))
        photos.push(await optimizePhoto(f));
      change((r) => ({ ...r, photos: [...r.photos, ...photos] }));
    }, "Обрабатываем фото");
    if (photoInput.current) photoInput.current.value = "";
  }
  function launchPayload(record: AdRecord) {
    return {
      batchId: record.batchId,
      recordId: record.id,
      profileId: profile.id,
      listing: { ...record.listing, title: listingTitle(record.listing) },
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
    const invalid = [
      ...validateListing(r.listing),
      ...platformValidation(r.listing, r.selected),
      ...(!r.categoryConfirmed ? ["Подтвердите категорию"] : []),
      ...(!r.prepared ? ["Подготовьте карточку"] : []),
      ...(!r.photos.length ? ["Добавьте фотографии"] : []),
      ...(!r.selected.length ? ["Выберите площадки"] : []),
      ...(!checked ? ["Подтвердите проверку данных"] : []),
    ];
    setErrors(invalid);
    if (invalid.length) return;
    if (!ext) {
      setShowExtension(true);
      return;
    }
    await guarded(async () => {
      const launched = {
        ...r,
        batchId: crypto.randomUUID(),
        jobs: r.selected.map((platformId) => ({
          platformId,
          status: "opening",
          message: "Открываем выбранную площадку.",
        })),
      };
      current.current = launched;
      setAd(launched);
      const responsePromise = extension("RUN", launchPayload(launched), 25000);
      await persist(launched);
      try {
        const response = await responsePromise;
        if (Array.isArray(response.jobs)) {
          await receive({
            batchId: launched.batchId,
            recordId: launched.id,
            jobs: response.jobs as Job[],
          });
        }
      } catch (e) {
        change((a) => ({
          ...a,
          jobs: a.jobs.map((j) => ({
            ...j,
            status: "error",
            message: errorText(e),
          })),
        }));
        throw e;
      }
    }, "Открываем площадки");
  }
  async function openJob(job: Job) {
    if (!ext) {
      setShowExtension(true);
      return;
    }
    await guarded(async () => {
      await extension("OPEN_JOB", {
        profileId: profile.id,
        batchId: ad.batchId,
        platformId: job.platformId,
      });
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
    change((r) => ({ ...r, listing: { ...r.listing, [key]: value } }));
  const nav = [
    ["editor", "Новое объявление", Plus],
    ["cabinet", "Мои объявления", ClipboardList],
    ["bulk", "Массовая загрузка", FileUp],
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
          <b>Автопост · MVP 0.3</b>
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
              {ext ? "Помощник подключён" : "Расширение 0.3.0"}
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
        <main>
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
                    <div className="prepare-row">
                      <span className="hint">ИИ использует только текст</span>
                      <button
                        className="primary"
                        disabled={!!busy || ad.text.trim().length < 15}
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
                                onChange={() => setCategoryId(c.id)}
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
                      onChange={setCategoryId}
                    />
                    <div className="prepare-row">
                      <span className="hint">
                        Вы подтверждаете выбор перед подготовкой
                      </span>
                      <button
                        className="primary"
                        disabled={
                          !categoryId || !!busy || ad.text.trim().length < 15
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
                      <span>На этом шаге ИИ их не анализирует</span>
                    </div>
                    <input
                      ref={photoInput}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(e) => upload(e.target.files)}
                    />
                    <div
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
                      </section>
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
                          ? "Помощник 0.3 подключён"
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
                <section className="submit-panel">
                  <div>
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
                    {busy || "Создать объявления"}
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
          {view === "integrations" && <Integrations notify={notify} />}
          {view === "bulk" && (
            <Bulk
              profile={profile}
              ads={ads}
              ext={ext}
              persist={persist}
              refresh={refresh}
              notify={notify}
              openRecord={openRecord}
              launchPayload={launchPayload}
              onProgress={receive}
            />
          )}
          <footer>
            <Logo />
            <span>MVP 0.3 · {taxonomy.version}</span>
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
            <h2>Расширение Автопост 0.3.0</h2>
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
              </li>
              <li>
                Нажмите «Создать объявления». Откроются все выбранные площадки с
                панелью помощника.
              </li>
              <li>
                Войдите при необходимости. Проверьте заполнение, завершите
                подачу и сохраните ссылку в панели.
              </li>
            </ol>
            <p className="fine-print">
              CAPTCHA и платные услуги требуют вашего действия. ABW требует
              разрешения на автоматизацию. Закрытые формы Bamper и Onlíner
              нуждаются в проверке после входа.
            </p>
            <div className="modal-actions">
              <a className="primary" href="/autopost-extension.zip" download>
                <Download size={17} />
                Скачать ZIP
              </a>
              <button
                className="secondary"
                onClick={() =>
                  extension("PING", undefined, 2000)
                    .then((r) => {
                      const ok = String(r.version).startsWith("0.3.");
                      setExt(ok);
                      notify(
                        ok
                          ? "Версия 0.3 подключена."
                          : "Обновите расширение до версии 0.3.0.",
                      );
                    })
                    .catch((e) => notify(errorText(e)))
                }
              >
                Проверить подключение
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
  onOpen,
  onNew,
  onRefresh,
  onLegacy,
  onArchive,
}: {
  ads: AdSummary[];
  onOpen: (id: string) => void;
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
                    "authorization_required",
                    "captcha_required",
                    "review_required",
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
          Обновить
        </button>
        <button className="text-button" onClick={() => void onLegacy()}>
          Перенести старые черновики
        </button>
      </div>
      <div className="ad-list">
        {!filtered.length && (
          <div className="panel empty-state">
            <ClipboardList size={40} />
            <h3>Пока нет объявлений</h3>
            <p>Создайте карточку или импортируйте таблицу.</p>
          </div>
        )}
        {filtered.map((a) => (
          <article className="panel ad-item" key={a.id}>
            <div>
              <span className="soft-badge">
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
            <div className="ad-job-chips">
              {a.jobs.map((j) => (
                <span key={j.platformId}>
                  {
                    getPlatforms(a.listing.category, a.listing.taxonomyId).find(
                      (p) => p.id === j.platformId,
                    )?.name
                  }
                  :{" "}
                  {j.url ? (
                    <a href={j.url} target="_blank" rel="noreferrer">
                      {statusLabel[j.status]} ↗
                    </a>
                  ) : (
                    statusLabel[j.status]
                  )}
                </span>
              ))}
            </div>
            <div className="job-actions">
              <button className="primary" onClick={() => onOpen(a.id)}>
                Открыть карточку
              </button>
              <button
                className="text-button"
                onClick={() => onArchive(a.id, !a.archived)}
              >
                {a.archived ? "Вернуть в работу" : "В архив кабинета"}
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="fine-print">
        Архивирование и отметки в Автопосте не удаляют объявления на площадках.
        Автоматическая проверка модерации, поднятие и снятие с продажи пока не
        подключены.
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
        узлов Куфар · {taxonomy.directories.onliner.length} разделов Onlíner
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
                  <strong>{p}</strong> {m.path.join(" → ")}{" "}
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
function Integrations({ notify }: { notify: (s: string) => void }) {
  const [settings, setSettings] = useState({
      company: "",
      contactPerson: "",
      phone: "",
      city: "",
      integrations: {} as Record<string, { enabled: boolean; notes: string }>,
    }),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ settings: typeof settings }>("workspace/settings")
      .then((r) => setSettings((s) => ({ ...s, ...r.settings })))
      .catch((e) => notify(errorText(e)));
  }, []);
  return (
    <>
      <h1>Интеграции и кабинет продавца</h1>
      <p className="subtitle">
        Официальные импорты подключаются к вашему аккаунту на площадке.
      </p>
      <div className="panel integration-profile">
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
                value={String(settings[key as keyof typeof settings] || "")}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
      </div>
      {[
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
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("workspace/settings", settings);
            notify(
              "Настройки сохранены. Отметка не активирует интеграцию автоматически.",
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

function Bulk({
  profile,
  ads,
  ext,
  persist,
  refresh,
  notify,
  openRecord,
  launchPayload,
  onProgress,
}: {
  profile: Profile;
  ads: AdSummary[];
  ext: boolean;
  persist: (r: AdRecord) => Promise<AdRecord>;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  openRecord: (id: string) => void;
  launchPayload: (r: AdRecord) => unknown;
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
  useEffect(() => setPreparedQueue([]), [selected]);
  const preview = useMemo(
    () => (table ? normalizeImport(table, columns, override) : []),
    [table, columns, override],
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
          XLSX, CSV, TSV, JSON · до 500 строк и 5 МБ. Названия колонок можно
          сопоставить вручную.
        </p>
        <input
          type="file"
          aria-label="Файл с объявлениями"
          accept=".xlsx,.csv,.tsv,.txt,.json"
          disabled={!!busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void work("Читаем файл", async () => {
                const next = await readImport(file);
                setTable(next);
                setColumns(guessColumns(next.headers));
                setConfirmed(false);
              });
            e.target.value = "";
          }}
        />
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
                  for (const item of valid) {
                    if (
                      item.record.externalId &&
                      ads.some((a) => a.externalId === item.record.externalId)
                    )
                      continue;
                    const photos: Photo[] = [];
                    for (const file of matchingPhotos(
                      item.record,
                      importPhotos,
                    ))
                      photos.push(await optimizePhoto(file));
                    await persist({ ...item.record, photos });
                    count++;
                    setBusy("Сохранено " + count + " из " + valid.length);
                  }
                  await refresh();
                  setTable(null);
                  setImportPhotos([]);
                  notify(
                    "Сохранено карточек: " +
                      count +
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
        <p className="section-subtitle">
          До 20 за запуск. Одна активная карточка на площадку; после сохранения
          ссылки или пропуска открывается следующая. Браузер должен оставаться
          открытым.
        </p>
        {ads
          .filter((a) => !a.archived)
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
                if (!ext) throw new Error("Установите расширение 0.3.0.");
                const records = await loadSelected();
                const problems = records.flatMap((r) => {
                  const e = [
                    ...validateListing(r.listing),
                    ...platformValidation(r.listing, r.selected),
                    ...(!r.categoryConfirmed
                      ? ["категория не подтверждена"]
                      : []),
                    ...(!r.photos.length ? ["нет фото"] : []),
                    ...(!r.selected.length ? ["не выбраны площадки"] : []),
                  ];
                  return e.length
                    ? [listingTitle(r.listing) + ": " + e.join(", ")]
                    : [];
                });
                if (problems.length)
                  throw new Error(problems.slice(0, 5).join(" · "));
                const items = records.map((r) => ({
                  ...r,
                  batchId: crypto.randomUUID(),
                  jobs: r.selected.map((platformId) => ({
                    platformId,
                    status: "ready",
                    message:
                      "Проверено. Ожидает запуска очереди пользователем.",
                  })),
                }));
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
              Запустить подготовленную очередь ({preparedQueue.length})
            </button>
          )}
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
          Конечный подраздел Flagma для выбранных карточек
          <input
            value={flagmaCategory}
            onChange={(e) => setFlagmaCategory(e.target.value)}
            placeholder="Точное название из справочника Flagma"
          />
        </label>
        <p className="fine-print">
          Выбирайте здесь товары одного подраздела. Если они относятся к разным
          категориям, экспортируйте отдельными группами.
        </p>
        <div className="job-actions">
          <button
            className="primary"
            disabled={!selected.length || !flagmaCategory || !!busy}
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
