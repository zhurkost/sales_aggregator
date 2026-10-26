"use client";
import { useEffect, useState } from "react";
import { Info, LoaderCircle, X } from "lucide-react";
import { Auth, Workspace, Logo } from "../components/workspace-ui";
import { api, type Profile } from "../lib/workspace";
export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [ready, setReady] = useState(false),
    [toast, setToast] = useState(""),
    [unavailable, setUnavailable] = useState(false);
  async function session() {
    try {
      const r = await api<{ profile: Profile | null; profiles: Profile[] }>(
        "workspace/session",
      );
      setProfile(r.profile);
      setProfiles(r.profiles);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void session();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 9000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <>
      {!ready ? (
        <div className="loading-page">
          <Logo />
          <LoaderCircle className="spin" size={28} />
          <p>Открываем личный кабинет…</p>
        </div>
      ) : unavailable ? (
        <div className="loading-page">
          <Logo />
          <h1>Кабинет временно недоступен</h1>
          <p>Проверьте соединение и повторите попытку.</p>
          <button
            className="primary"
            onClick={() => {
              setReady(false);
              void session();
            }}
          >
            Повторить
          </button>
          <a href="https://87.199.205.227">
            Открыть Автопост на основном сервере ↗
          </a>
        </div>
      ) : profile ? (
        <Workspace
          key={profile.id}
          profile={profile}
          onLogout={() => void session()}
          notify={setToast}
        />
      ) : (
        <Auth profiles={profiles} onLogin={setProfile} onError={setToast} />
      )}{" "}
      {toast && (
        <div className="toast" role="status">
          <Info size={18} />
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <X size={17} />
          </button>
        </div>
      )}
    </>
  );
}
