(function (root) {
  "use strict";
  const starts = Object.freeze({
    kufar: "https://www.kufar.by/ain/create",
    onliner: "https://r.onliner.by/ak/apartments/create",
    realt: "https://realt.by/podat-obyavlenie/",
    domovita: "https://domovita.by/new/add",
  });
  const saleStarts = Object.freeze({ ...starts, onliner: "https://r.onliner.by/pk/apartments/create" });
  const houseStarts = Object.freeze({ ...starts, domovita: "https://domovita.by/new/add/cottages/rent" });
  const houseSaleStarts = Object.freeze({ ...saleStarts, domovita: "https://domovita.by/new/add/cottages/sale" });
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  const id = (v) => typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(v);
  function origin(platform, url) {
    try {
      return new URL(url).origin === new URL(starts[platform]).origin;
    } catch {
      return false;
    }
  }
  function validate(payload) {
    if (
      !object(payload) ||
      !id(payload.profileId) ||
      !id(payload.id) ||
      !Number.isInteger(payload.revision) ||
      payload.revision < 1 ||
      !["assist", "automatic"].includes(payload.mode)
    )
      throw new Error("Неверная карточка объявления.");
    if (
      !Array.isArray(payload.jobs) ||
      !payload.jobs.length ||
      payload.jobs.length > 4 ||
      new Set(payload.jobs.map((j) => j.platform)).size !== payload.jobs.length
    )
      throw new Error("Выберите площадки.");
    if (JSON.stringify(payload).length > 6000000)
      throw new Error("Слишком большой пакет фотографий.");
    const allowedStarts = payload.categoryId === "houses_sale" ? houseSaleStarts : payload.categoryId === "apartments_sale" ? saleStarts : payload.categoryId === "houses_long_term_rent" ? houseStarts : starts;
    for (const job of payload.jobs) {
      if (
        !object(job) ||
        !Object.hasOwn(starts, job.platform) ||
        allowedStarts[job.platform] !== job.startUrl ||
        job.format !== 1 ||
        !Array.isArray(job.controls) ||
        job.controls.length > 150 ||
        !Array.isArray(job.ready) ||
        !job.ready.length ||
        job.ready.some(
          (r) => typeof r.selector !== "string" || r.selector.length > 400,
        )
      )
        throw new Error("Обновите правила площадки.");
      for (const c of job.controls) {
        if (
          !object(c) ||
          typeof c.field !== "string" ||
          typeof c.selector !== "string" ||
          c.selector.length > 400 ||
          ![
            "text",
            "richtext",
            "check",
            "choices",
            "select",
            "dropdown",
            "autocomplete",
            "files",
          ].includes(c.action)
        )
          throw new Error("Неизвестное правило заполнения.");
        if (
          c.index !== undefined &&
          (!Number.isInteger(c.index) || c.index < 0 || c.index > 19)
        )
          throw new Error("Неверный индекс поля.");
      }
      for (const phase of ["setup", "next", "submit"])
        if (
          !Array.isArray(job[phase]) ||
          job[phase].length > 10 ||
          job[phase].some(
            (s) =>
              s.action !== "click" ||
              typeof s.selector !== "string" ||
              typeof s.text !== "string",
          )
        )
          throw new Error("Неизвестный переход формы.");
    }
    const photos = payload.photos || [];
    if (
      !Array.isArray(photos) ||
      photos.length > 12 ||
      photos.some(
        (p) =>
          !object(p) ||
          !id(p.id) ||
          typeof p.name !== "string" ||
          !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(
            p.dataUrl,
          ) ||
          p.dataUrl.length > 400000,
      )
    )
      throw new Error("Фотографии: до 12 файлов JPG, PNG, WebP.");
    return structuredClone(payload);
  }
  root.AutopostRentalCore = Object.freeze({ starts, origin, validate, id });
  if (typeof module !== "undefined") module.exports = root.AutopostRentalCore;
})(globalThis);
