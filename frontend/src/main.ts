import { bootstrapApplication } from "@angular/platform-browser";
import {
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from "@angular/core";
import { registerLocaleData } from "@angular/common";
import { provideHttpClient, withFetch, withInterceptors } from "@angular/common/http";
import localeRu from "@angular/common/locales/ru";
import { AppComponent } from "./app/app.component";
import { rentalInterceptor } from "./app/rental/rental-api";
registerLocaleData(localeRu);
bootstrapApplication(AppComponent, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection(),
    { provide: LOCALE_ID, useValue: "ru" },
    provideHttpClient(withFetch(), withInterceptors([rentalInterceptor])),
  ],
}).catch(console.error);
