import { bootstrapApplication } from "@angular/platform-browser";
import {
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from "@angular/core";
import { registerLocaleData } from "@angular/common";
import localeRu from "@angular/common/locales/ru";
import { AppComponent } from "./app/app.component";
registerLocaleData(localeRu);
bootstrapApplication(AppComponent, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection(),
    { provide: LOCALE_ID, useValue: "ru" },
  ],
}).catch(console.error);
