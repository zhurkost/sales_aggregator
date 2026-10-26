import type { Listing, ProductGroup } from "./listing.ts";
import { categoryById } from "./taxonomy.ts";
export type Platform = {
  id: string;
  canonicalId: string;
  name: string;
  short: string;
  domain: string;
  color: string;
  kind: "extension" | "manual" | "import";
  tag: string;
  description: string;
  note: string;
  url: string;
  source: string;
  sourceLabel: string;
};
const catalog: Platform[] = [
  {
    id: "avby",
    canonicalId: "av",
    name: "av.by",
    short: "av",
    domain: "av.by",
    color: "#e93d3a",
    kind: "extension",
    tag: "Помощник в браузере",
    description: "Автомобильная площадка",
    note: "Открытие подачи, заполнение доступных полей в вашей сессии. Защищённая форма требует входа.",
    url: "https://av.by/",
    source: "https://av.by/",
    sourceLabel: "Сайт площадки",
  },
  {
    id: "kufar",
    canonicalId: "kufar",
    name: "Куфар",
    short: "k",
    domain: "kufar.by",
    color: "#207c56",
    kind: "extension",
    tag: "Категория и поля автоматически",
    description: "Универсальная площадка Беларуси",
    note: "Прямой переход к форме, выбор категории, обычные поля, списки и фото. Вход и CAPTCHA выполняются в браузере. Валюта выбирается по форме, без пересчёта.",
    url: "https://www.kufar.by/ain/create",
    source: "https://import-docs.kufar.by/import_documentation_revision_5.html",
    sourceLabel: "Официальный импорт KML",
  },
  {
    id: "onliner",
    canonicalId: "onliner",
    name: "Onlíner",
    short: "O",
    domain: "onliner.by",
    color: "#ffbe29",
    kind: "extension",
    tag: "Помощник в браузере",
    description: "Автобарахолка и товарные разделы",
    note: "Для автомобилей открывается Автобарахолка, для товаров — форма Барахолки. Помощник переносит доступные поля; закрытая форма требует входа.",
    url: "https://ab.onliner.by/",
    source: "https://baraholka.onliner.by/",
    sourceLabel: "Справочник разделов",
  },
  {
    id: "abw",
    canonicalId: "abw",
    name: "ABW",
    short: "abw",
    domain: "abw.by",
    color: "#263b68",
    kind: "manual",
    tag: "Требуется разрешение на интеграцию",
    description: "Автомобили и запчасти",
    note: "Правила ABW, п. 2.14: для автоматической подачи необходимо разрешение площадки. Вкладка и панель Автопоста открываются, текст и учёт ссылки доступны.",
    url: "https://abw.by/",
    source: "https://abw.by/submitting-advert",
    sourceLabel: "Правила размещения",
  },
  {
    id: "bamper",
    canonicalId: "bamper",
    name: "Bamper.by",
    short: "B",
    domain: "bamper.by",
    color: "#2973cf",
    kind: "extension",
    tag: "Помощник в кабинете",
    description: "Запчасти и автомобильные товары",
    note: "Помощник использует вашу авторизацию, распознаёт отдельные поля и списки. Точный набор полей кабинета требует проверки после входа. Excel/CSV-фид подключается по условиям Bamper.",
    url: "https://bamper.by/personal/add.php?action=add",
    source: "https://bamper.by/contacts/",
    sourceLabel: "Размещение и импорт",
  },
  {
    id: "flagma",
    canonicalId: "flagma",
    name: "Flagma",
    short: "F",
    domain: "flagma.by",
    color: "#ea7b34",
    kind: "extension",
    tag: "Форма или импорт XLSX",
    description: "Товары и услуги",
    note: "В разделе массовой загрузки можно подготовить XLSX по опубликованной схеме. Укажите конечную категорию из справочника Flagma. Загрузка выполняется в аккаунте продавца.",
    url: "https://flagma.by/podat-obyavlenie.html",
    source: "https://flagma.by/import",
    sourceLabel: "Официальный импорт",
  },
  {
    id: "drom",
    canonicalId: "drom",
    name: "Дром",
    short: "д",
    domain: "auto.drom.ru",
    color: "#dc3738",
    kind: "extension",
    tag: "Условия аккаунта нужно проверить",
    description: "Дополнительный автомобильный канал",
    note: "Форма для Минска. Допуск аккаунта и условия автозагрузки проверяются на площадке.",
    url: "https://auto.drom.ru/minsk/addbull/",
    source: "https://www.drom.ru/misc/autoload/",
    sourceLabel: "Автозагрузка",
  },
];
export const platforms = catalog.filter((p) => p.id !== "bamper");
export const partsPlatforms = [
  "bamper",
  "kufar",
  "onliner",
  "abw",
  "flagma",
].map((id) => {
  const p = catalog.find((p) => p.id === id)!;
  return {
    ...p,
    id: id === "bamper" ? id : id + "-parts",
    url:
      id === "onliner"
        ? "https://baraholka.onliner.by/fleamarketposting.php"
        : id === "abw"
          ? "https://abw.by/carparts"
          : p.url,
  };
});
export function getPlatforms(
  category: ProductGroup,
  taxonomyId = "",
): Platform[] {
  if (category === "parts") return partsPlatforms;
  if (category === "cars") return platforms;
  const mapping = categoryById(taxonomyId)?.mappings;
  return catalog
    .filter(
      (p) =>
        ["kufar", "onliner", "flagma"].includes(p.id) &&
        (!mapping || p.id === "flagma" || mapping[p.canonicalId]),
    )
    .map((p) => ({
      ...p,
      id: p.id + "-general",
      url:
        p.id === "onliner"
          ? "https://baraholka.onliner.by/fleamarketposting.php"
          : p.url,
    }));
}
export function defaultPlatforms(category: ProductGroup, taxonomyId = "") {
  return getPlatforms(category, taxonomyId)
    .filter((p) =>
      category === "parts"
        ? ["bamper", "kufar-parts"].includes(p.id)
        : category === "cars"
          ? ["avby", "kufar"].includes(p.id)
          : p.canonicalId === "kufar" || p.canonicalId === "onliner",
    )
    .map((p) => p.id);
}
export function platformValidation(listing: Listing, selected: string[]) {
  const errors: string[] = [];
  const allowed = getPlatforms(listing.category, listing.taxonomyId);
  if (selected.some((id) => !allowed.some((p) => p.id === id)))
    errors.push("Площадка не подходит категории");
  if (listing.category === "parts" && selected.includes("bamper"))
    for (const [key, label] of [
      ["brand", "марка автомобиля"],
      ["model", "модель автомобиля"],
      ["year", "год автомобиля"],
    ] as const)
      if (!listing[key]) errors.push("Для Bamper: " + label);
  return errors;
}
export type Job = {
  platformId: string;
  status: string;
  message: string;
  tabId?: number;
  url?: string;
  filledFields?: number;
  photosTransferred?: number;
};
export const statusLabel: Record<string, string> = {
  draft: "Черновик",
  ready: "Подготовлено",
  queued: "В очереди",
  opening: "Открываем форму",
  category_required: "Уточните категорию",
  authorization_required: "Нужен вход",
  captcha_required: "Нужна CAPTCHA",
  review_required: "Проверьте перед подачей",
  manual_required: "Нужен ваш шаг",
  error: "Ошибка",
  filled: "Поля заполнены",
  cancelled: "Остановлено",
  submitted: "Отправлено, ждём модерацию",
  published: "Опубликовано",
  link_recorded: "Ссылка сохранена пользователем",
  inactive: "Неактивно по отметке пользователя",
  unsupported: "Нужно подключение площадки",
};
export function safePublicationUrl(
  platformId: unknown,
  value: unknown,
): string {
  if (
    typeof platformId !== "string" ||
    typeof value !== "string" ||
    value.length > 1500
  )
    return "";
  const id = platformId.replace(/-(parts|general)$/, "");
  const domains: Record<string, string[]> = {
    avby: ["av.by", "cars.av.by"],
    av: ["av.by", "cars.av.by"],
    kufar: ["www.kufar.by", "kufar.by", "auto.kufar.by"],
    bamper: ["bamper.by", "www.bamper.by"],
    onliner: ["ab.onliner.by", "baraholka.onliner.by", "mb.onliner.by"],
    abw: ["abw.by", "www.abw.by"],
    flagma: ["flagma.by"],
    drom: ["auto.drom.ru"],
  };
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !domains[id]?.includes(u.hostname)
    )
      return "";
    u.hash = "";
    return u.href;
  } catch {
    return "";
  }
}
