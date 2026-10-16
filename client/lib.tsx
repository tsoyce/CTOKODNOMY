import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  defaultBrand,
  type Brand,
  type Me,
  type SiteInfo,
} from "../shared/types";
import { isLightBrand, themeTokens } from "./theme";

export type AppearanceMode = "light" | "dark" | "brand";
const appearanceStorageKey = "ctokodnomy:appearance";
function isAppearanceMode(value: string | null): value is AppearanceMode {
  return value === "light" || value === "dark" || value === "brand";
}
function readAppearance(): AppearanceMode {
  try {
    const stored = localStorage.getItem(appearanceStorageKey);
    return isAppearanceMode(stored) ? stored : "light";
  } catch {
    return "light";
  }
}
function resolveBrandAppearance(brand: Brand, mode: AppearanceMode): Brand {
  if (mode === "brand") return brand;
  return {
    ...brand,
    ...(mode === "light"
      ? { background: "#f4f7fb", textColor: "#142036" }
      : { background: "#111827", textColor: "#f3f6fc" }),
  };
}
const AppearanceContext = createContext<{
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
  resolveAppearance: (brand: Brand) => Brand;
}>({
  mode: "light",
  setMode: () => {},
  resolveAppearance: (brand) => resolveBrandAppearance(brand, "light"),
});

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== "/login" && path !== "/me")
      window.dispatchEvent(new Event("ctok-auth-expired"));
    throw new ApiError(
      body?.message || "Не удалось выполнить запрос. Попробуйте ещё раз.",
      response.status,
    );
  }
  return body as T;
}
export function brandStyle(brand: Brand): CSSProperties {
  return {
    ...themeTokens(brand),
    colorScheme: isLightBrand(brand) ? "light" : "dark",
  } as CSSProperties;
}
const SiteContext = createContext<{
  site: SiteInfo | null;
  refresh: () => Promise<void>;
}>({ site: null, refresh: async () => {} });
const MeContext = createContext<{
  me: Me | null;
  refresh: () => Promise<void>;
}>({ me: null, refresh: async () => {} });
export function AppProvider({ children }: { children: ReactNode }) {
  const [mode, setAppearance] = useState<AppearanceMode>(readAppearance);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const setMode = useCallback((next: AppearanceMode) => {
    if (!isAppearanceMode(next)) return;
    setAppearance(next);
    try {
      localStorage.setItem(appearanceStorageKey, next);
    } catch {
      /* Appearance still works when browser storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    const syncAppearance = (event: StorageEvent) => {
      if (event.key !== appearanceStorageKey && event.key !== null) return;
      setAppearance(isAppearanceMode(event.newValue) ? event.newValue : "light");
    };
    window.addEventListener("storage", syncAppearance);
    return () => window.removeEventListener("storage", syncAppearance);
  }, []);
  const appearance = useMemo(
    () => ({
      mode,
      setMode,
      resolveAppearance: (brand: Brand) => resolveBrandAppearance(brand, mode),
    }),
    [mode, setMode],
  );
  const displayBrand = appearance.resolveAppearance(site?.brand ?? defaultBrand);
  const refreshSite = useCallback(async () => {
    const nextSite = await api<SiteInfo>("/site");
    setSite({ ...nextSite, brand: { ...defaultBrand, ...nextSite.brand } });
    setError("");
  }, []);
  const refreshMe = useCallback(async () => {
    setMe(await api<Me>("/me"));
  }, []);
  useEffect(() => {
    Promise.all([refreshSite(), refreshMe()]).catch((e) => setError(e.message));
  }, [refreshSite, refreshMe]);
  useEffect(() => {
    const expired = () => {
      void refreshMe().catch((e) => setError(e.message));
    };
    window.addEventListener("ctok-auth-expired", expired);
    return () => window.removeEventListener("ctok-auth-expired", expired);
  }, [refreshMe]);
  useEffect(() => {
    const brand = site?.brand ?? defaultBrand;
    document.title = [brand.title, brand.organizer].filter(Boolean).join(" · ");
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (brand.faviconUrl) {
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.append(favicon);
      }
      favicon.href = brand.faviconUrl;
    } else favicon?.remove();
  }, [site]);
  useEffect(() => {
    document.documentElement.style.backgroundColor = displayBrand.background;
    document.documentElement.style.colorScheme = isLightBrand(displayBrand)
      ? "light"
      : "dark";
  }, [displayBrand.background]);
  return (
    <AppearanceContext.Provider value={appearance}>
      <SiteContext.Provider value={{ site, refresh: refreshSite }}>
        <MeContext.Provider value={{ me, refresh: refreshMe }}>
          <div
            className="app"
            data-theme={isLightBrand(displayBrand) ? "light" : "dark"}
            data-appearance={mode}
            style={brandStyle(displayBrand)}
          >
            {error && (
              <div className="service-alert" role="alert">
                {error}{" "}
                <button
                  onClick={() =>
                    Promise.all([refreshSite(), refreshMe()]).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  Повторить
                </button>
              </div>
            )}
            {children}
          </div>
        </MeContext.Provider>
      </SiteContext.Provider>
    </AppearanceContext.Provider>
  );
}
export const useSite = () => useContext(SiteContext);
export const useMe = () => useContext(MeContext);
export const useAppearance = () => useContext(AppearanceContext);

export function useLiveGame<T extends { revision: number }>(
  id: string | undefined,
  view: "public" | "host" | "team",
) {
  const [game, setGame] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const currentKey = useRef(`${id}/${view}`);
  currentKey.current = `${id}/${view}`;
  const refresh = useCallback(async () => {
    if (!id) return;
    const scope = generation.current,
      key = `${id}/${view}`;
    const valid = () =>
      alive.current &&
      generation.current === scope &&
      currentKey.current === key;
    try {
      const data = await api<T>(`/games/${encodeURIComponent(id)}/${view}`);
      if (valid()) {
        setGame((previous) =>
          previous && previous.revision > data.revision ? previous : data,
        );
        setError("");
      }
    } catch (e) {
      if (valid()) {
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          setGame(null);
          if (view === "team" && e.status === 403)
            window.dispatchEvent(new Event("ctok-auth-expired"));
        }
        setError(e instanceof Error ? e.message : "Ошибка соединения");
      }
    } finally {
      if (valid()) setLoading(false);
    }
  }, [id, view]);
  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    setGame(null);
    setLoading(true);
    setError("");
    void refresh();
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let retry = 1000;
    const connect = () => {
      if (stopped || !id) return;
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws/games/${encodeURIComponent(id)}`,
      );
      socket.onopen = () => {
        if (stopped) return;
        setConnected(true);
        retry = 1000;
        void refresh();
      };
      socket.onmessage = () => {
        void refresh();
      };
      socket.onclose = () => {
        if (!stopped) {
          setConnected(false);
          timer = setTimeout(connect, retry);
          retry = Math.min(retry * 2, 10000);
        }
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    const visibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    const poll = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      stopped = true;
      alive.current = false;
      generation.current += 1;
      clearTimeout(timer);
      clearInterval(poll);
      socket?.close();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id, view, refresh]);
  return { game, loading, error, connected, refresh };
}
