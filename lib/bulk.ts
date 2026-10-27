import {
  emptyListing,
  sanitizeListing,
  validateListing,
  type Listing,
} from "./listing.ts";
import { categoryById, suggestCategories, categoryMapping } from "./taxonomy.ts";
import { newRecord, withSellerContacts, type SellerContacts, type AdRecord } from "./workspace.ts";
import { defaultPlatforms } from "./platforms.ts";
import {descriptionWithAttributes} from "./attributes.ts";

export function parseDelimited(text: string): string[][] {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  const delimiter = first.includes("\t")
    ? "\t"
    : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (!field || quoted) quoted = !quoted;
      else field += c;
    } else if (c === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("В CSV не закрыты кавычки.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
const names: Record<string, string[]> = {
  title: ["title", "название", "наименование", "заголовок"],
  description: ["description", "описание", "текст"],
  taxonomyId: ["taxonomyid", "категория автопост", "category_id"],
  category: ["category", "товарная группа"],
  price: ["price", "цена", "стоимость"],
  currency: ["currency", "валюта"],
  brand: ["brand", "марка"],
  model: ["model", "модель"],
  year: ["year", "год", "год выпуска"],
  city: ["city", "город"],
  phone: ["phone", "телефон"],
  partName: ["partname", "название детали", "запчасть"],
  partNumber: ["partnumber", "артикул", "oem", "номер запчасти"],
  condition: ["condition", "состояние"],
  priceUnit: ["priceunit", "единица продажи", "цена указана"],
  manufacturer: ["manufacturer", "производитель"],
  quantity: ["quantity", "количество"],
  availability: ["availability", "наличие"],
  mileage: ["mileage", "пробег"],
  externalId: ["id", "externalid", "внешний id"],
  photoUrls: [
    "photos",
    "photo",
    "фото",
    "ссылки на фото",
    "файлы фото",
    "photoUrls".toLowerCase(),
  ],
};
export const importFields = Object.keys(names);
export function guessColumns(headers: string[]) {
  return Object.fromEntries(
    headers.map((h) => [
      h,
      Object.keys(names).find((k) =>
        names[k].includes(h.trim().toLowerCase()),
      ) || "",
    ]),
  );
}
export type ImportTable = { headers: string[]; rows: Record<string, string>[] };
export async function readImport(file: File): Promise<ImportTable> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Лимит файла — 5 МБ.");
  if (/\.(xml|yml)$/i.test(file.name)) {
    const {readYml}=await import('./catalog-import.ts');
    const bytes=await file.arrayBuffer();
    const head=new TextDecoder().decode(bytes.slice(0,200));
    return readYml(new TextDecoder(/encoding\s*=\s*["']windows-1251["']/i.test(head)?'windows-1251':'utf-8').decode(bytes));
  }
  let rows: Record<string, string>[] = [];
  if (/\.json$/i.test(file.name)) {
    const json = JSON.parse(await file.text());
    const list = Array.isArray(json) ? json : json.listings || json.ads;
    if (!Array.isArray(list))
      throw new Error("JSON должен содержать массив объявлений.");
    rows = list.map((item) =>
      Object.fromEntries(
        Object.entries(
          item.listing
            ? {
                ...item.listing,
                externalId: item.externalId || item.id,
                photos: (item.photoRefs || []).join("|"),
              }
            : item,
        )
          .filter(([, v]) => typeof v === "string" || typeof v === "number")
          .map(([k, v]) => [k, String(v)]),
      ),
    );
  } else {
    let matrix: string[][];
    if (/\.xlsx$/i.test(file.name)) {
      const excel = await import("exceljs");
      const Workbook = excel.default?.Workbook || excel.Workbook;
      const book = new Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const sheet = book.worksheets[0];
      if (!sheet) throw new Error("Книга Excel пуста.");
      if (sheet.rowCount > 501)
        throw new Error("В одном файле — до 500 объявлений.");
      matrix = [];
      sheet.eachRow((row) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          const v = cell.value;
          values[col - 1] =
            typeof v === "object" && v && "formula" in v ? "" : cell.text;
        });
        matrix.push(values);
      });
    } else if (/\.(csv|tsv|txt)$/i.test(file.name)) {
      const bytes=await file.arrayBuffer();let source:string;
      try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{source=new TextDecoder('windows-1251').decode(bytes);}
      matrix = parseDelimited(source);
    }
    else
      throw new Error(
        "Поддерживаются XLSX, CSV, TSV и JSON. Старый XLS сохраните как XLSX.",
      );
    const headers = matrix.shift()?.map((h) => h.trim()) || [];
    if (new Set(headers).size !== headers.length)
      throw new Error("В таблице повторяются названия колонок.");
    rows = matrix.map((values) =>
      Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])),
    );
  }
  if (!rows.length || rows.length > 500)
    throw new Error("В файле должно быть от 1 до 500 объявлений.");
  return {
    headers: [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 100),
    rows,
  };
}
export type ImportPreview = {
  record: AdRecord;
  errors: string[];
  sourceRow: number;
  duplicate: boolean;
};
export function normalizeImport(
  table: ImportTable,
  columns: Record<string, string>,
  categoryOverride = "",
  contacts: SellerContacts = {},
): ImportPreview[] {
  const seen = new Set<string>();
  return table.rows.map((row, index) => {
    const mapped: Record<string, string> = {};
    for (const [header, target] of Object.entries(columns))
      if (target) mapped[target] = row[header] || "";
    const known =
      categoryById(categoryOverride || mapped.taxonomyId) ||
      categoryById(
        mapped.category === "cars"
          ? "auto.cars"
          : mapped.category === "parts"
            ? "auto.parts"
            : "",
      );
    const candidate =
      known ||
      categoryById(
        suggestCategories(
          [mapped.title, mapped.description, mapped.partName].join(" "),
        )[0]?.id || "",
      );
    const listing = withSellerContacts(sanitizeListing({
      ...mapped,price:(mapped.price||'').replace(',','.'),
      taxonomyId: candidate?.id || "",
      category: candidate?.group || "general",
    }), contacts);
    const record = newRecord(listing, listing.description);
    record.externalId = mapped.externalId;
    record.photoRefs = (mapped.photoUrls || "")
      .split(/[|\n]/)
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 12);
    record.prepared = true;
    record.categoryConfirmed = !!known;
    record.selected = defaultPlatforms(listing.category, listing.taxonomyId);
    const signature = mapped.externalId
      ? "id:" + mapped.externalId
      : JSON.stringify([
          listing.title,
          listing.partNumber,
          listing.description,
          listing.price,
        ]);
    const duplicate = seen.has(signature);
    seen.add(signature);
    return {
      record,
      sourceRow: index + 2,
      duplicate,
      errors: [
        ...validateListing(listing),
        ...(!known ? ["Подтвердите категорию"] : []),
        ...(duplicate ? ["Повтор строки в файле"] : []),
      ],
    };
  });
}
export function csvExport(records: AdRecord[]) {
  const fields = ["externalId", "photos", ...Object.keys(emptyListing)];
  const cell = (value: unknown) =>
    '"' +
    String(value ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return (
    "\uFEFF" +
    [
      fields.map(cell).join(";"),
      ...records.map((r) =>
        fields
          .map((k) =>
            cell(
              k === "photos"
                ? (r.photoRefs || []).join("|")
                : k === "externalId"
                  ? r.externalId || r.id
                  : k === 'description' ? descriptionWithAttributes(r.listing,r.attributes,r.categoryOverrides) : r.listing[k as keyof Listing],
            ),
          )
          .join(";"),
      ),
    ].join("\r\n")
  );
}
export function flagmaRows(
  records: AdRecord[],
  categories: Record<string, string>,
) {
  const errors: string[] = [];
  const rows = records.map((r) => {
    const c = categories[r.id]?.trim() || categoryMapping(r.listing.taxonomyId,'flagma',r.categoryOverrides)?.id;
    if (!c)
      errors.push(
        (r.listing.title || r.id) + ": укажите конечный подраздел Flagma",
      );
    if (!r.listing.title || !r.listing.description)
      errors.push(r.id + ": нужны название и описание");
    if (
      /(?:\+375|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/)/i.test(
        r.listing.title + " " + r.listing.description,
      )
    )
      errors.push(
        (r.listing.title || r.id) +
          ": уберите контакты и ссылки из текста для Flagma",
      );
    return {
      Тип: "Продам",
      Название: r.listing.title,
      Описание: descriptionWithAttributes(r.listing,r.attributes,r.categoryOverrides),
      "Конечный подраздел": c || "",
      Цена: r.listing.price ? Number(r.listing.price) : "",
      "Единица измерения": r.listing.priceUnit === "За штуку" ? "шт" : "",
      Валюта: r.listing.currency.toLowerCase(),
      "Фото товара":
        (r.photoRefs || []).find((v) => /^https:\/\/[^\s]+$/i.test(v)) || "",
      Неактивное: "да",
    };
  });
  return { rows, errors };
}

/** Match explicit filenames or ID_1.jpg / ID-1.jpg. Never fetch remote images. */
export function matchingPhotos<T extends { name: string }>(
  record: AdRecord,
  files: T[],
): T[] {
  const basename = (v: string) => {
    try {
      return decodeURIComponent(
        v.split(/[\\/]/).at(-1)!.split("?")[0],
      ).toLowerCase();
    } catch {
      return "";
    }
  };
  const refs = new Set((record.photoRefs || []).map(basename));
  const id = record.externalId?.toLowerCase();
  return files
    .filter((file) => {
      const name = basename(file.name);
      if (refs.size) return refs.has(name);
      if (!id) return false;
      const stem = name.replace(/\.(?:jpg|jpeg|png|webp)$/i, "");
      return (
        stem === id ||
        ((stem.startsWith(id + "_") || stem.startsWith(id + "-")) &&
          /^\d+$/.test(stem.slice(id.length + 1)))
      );
    })
    .slice(0, 12);
}
export async function flagmaXlsx(
  records: AdRecord[],
  categories: Record<string, string>,
) {
  const { rows, errors } = flagmaRows(records, categories);
  if (errors.length) throw new Error(errors.join(" · "));
  const excel = await import("exceljs");
  const Workbook = excel.default?.Workbook || excel.Workbook;
  const book = new Workbook();
  const sheet = book.addWorksheet("Импорт");
  sheet.columns = Object.keys(rows[0]).map((key) => ({
    header: key,
    key,
    width: key === "Описание" ? 65 : 25,
  }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  return await book.xlsx.writeBuffer();
}
