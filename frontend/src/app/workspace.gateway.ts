import { Injectable } from "@angular/core";
import { api, setWorkspaceContext, extension, type Profile } from "../../../lib/workspace";
import type { RentalProfile } from "./rental/rental-profile-defaults";

/** The shell knows user actions; this adapter owns API paths and workspace headers. */
@Injectable({ providedIn: "root" })
export class WorkspaceGateway {
  session() {
    return api<{ profile: Profile | null; profiles: Profile[] }>("workspace/session");
  }
  authenticate(mode: "login" | "register", input: { login: string; password: string; name: string }) {
    return api<{ profile: Profile }>("workspace/" + mode, input);
  }
  async settings(profile: Profile) {
    setWorkspaceContext(profile.id);
    return (await api<{ settings: RentalProfile }>("workspace/settings")).settings;
  }
  async logout() {
    await api("workspace/logout", {});
    this.clearContext();
  }
  clearContext() { setWorkspaceContext(""); }
  pingExtension() { return extension("PING"); }
  activeDeal(profileId: string): "rent" | "sale" {
    try {
      return sessionStorage.getItem("autopost.active-deal." + profileId) === "sale" ? "sale" : "rent";
    } catch { return "rent"; }
  }
  rememberDeal(profileId: string, deal: "rent" | "sale") {
    try {
      sessionStorage.setItem("autopost.active-deal." + profileId, deal);
    } catch { /* Browser storage may be disabled; selection still works in memory. */ }
  }
}
