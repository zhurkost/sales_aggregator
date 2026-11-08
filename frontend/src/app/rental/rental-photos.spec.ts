import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {importRentalPhotoLinks} from "./rental-photos";
const bitmap=vi.fn(async()=>({width:800,height:600,close:()=>{}}));
beforeEach(()=>{
  vi.stubGlobal("createImageBitmap",bitmap);
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage:()=>{}} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"toDataURL").mockReturnValue("data:image/jpeg;base64,AAAA");
});
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks();});

it("imports HTTPS image bytes in order without sending credentials", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1,2,3]), {headers:{"Content-Type":"image/png"}}));
  vi.stubGlobal("fetch", fetcher);
  const links = ["https://example.com/a.png", "https://example.com/b.png"];
  const photos = await importRentalPhotoLinks([], links);
  expect(photos.map(p=>p.sourceUrl)).toEqual(links);
  expect(photos.map(p=>p.name)).toEqual(["a.jpg","b.jpg"]);
  expect(fetcher).toHaveBeenCalledWith(new URL(links[0]), expect.objectContaining({credentials:"omit",referrerPolicy:"no-referrer"}));
  expect(bitmap).toHaveBeenCalledTimes(2);
});

it("does not treat an HTML response as a photo and explains how to recover from blocked downloads", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Login</html>", {headers:{"Content-Type":"text/html"}})));
  await expect(importRentalPhotoLinks([], ["https://example.com/image"])).rejects.toThrow("＋ Фото");
  expect(bitmap).not.toHaveBeenCalled();
});

it("checks the combined photo count before downloading", async () => {
  const fetcher = vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(importRentalPhotoLinks([],Array(13).fill("https://example.com/image"))).rejects.toThrow("12");
  expect(fetcher).not.toHaveBeenCalled();
});
