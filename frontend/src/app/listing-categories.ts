export const APARTMENT_RENT = "apartments_long_term_rent";
export const APARTMENT_SALE = "apartments_sale";
export const HOUSE_RENT = "houses_long_term_rent";
export const HOUSE_SALE = "houses_sale";

export const LISTING_TABS = [
  { id: "rent", category: APARTMENT_RENT, label: "Аренда квартир", deal: "rent", objectKind: "apartment" },
  { id: "sale", category: APARTMENT_SALE, label: "Продажа квартир", deal: "sale", objectKind: "apartment" },
  { id: "house-rent", category: HOUSE_RENT, label: "Аренда домов", deal: "rent", objectKind: "house" },
  { id: "house-sale", category: HOUSE_SALE, label: "Продажа домов", deal: "sale", objectKind: "house" },
] as const;
export type ListingTabId = typeof LISTING_TABS[number]["id"];
