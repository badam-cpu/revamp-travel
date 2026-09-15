/**
 * Display-currency switcher (AMD / USD). Prices SETTLE in USD (PayLink); this is
 * a presentation layer only — it converts USD amounts to the viewer's chosen
 * currency at the admin-set rate (site_settings.usd_to_amd_rate, via
 * SiteSettingsContext). The actual charge is always USD; checkout notes that
 * when AMD is shown.
 *
 * The viewer's choice is remembered in localStorage. AMD is only offered when a
 * rate is set (> 0); if it's ever cleared, we fall back to USD.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";

export type DisplayCurrency = "USD" | "AMD";
const STORAGE_KEY = "revamp.displayCurrency";

interface CurrencyContextValue {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  /** True when an AMD rate is configured, so the switcher can be shown. */
  amdEnabled: boolean;
  rate: number; // AMD per 1 USD (0 = unset)
  /** Format an amount given in USD cents into the active display currency. */
  format: (usdCents: number) => string;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "USD",
  setCurrency: () => {},
  amdEnabled: false,
  rate: 0,
  format: (c) => `$${c / 100}`,
});

export const useCurrency = () => useContext(CurrencyContext);

function readStored(): DisplayCurrency {
  try {
    return localStorage.getItem(STORAGE_KEY) === "AMD" ? "AMD" : "USD";
  } catch {
    return "USD";
  }
}

function usd(cents: number): string {
  const major = cents / 100;
  const n = major % 1 === 0 ? major.toLocaleString() : major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${n}`;
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { settings } = useSiteSettings();
  const rate = settings.usdToAmdRate || 0;
  const amdEnabled = rate > 0;
  const [currency, setCurrencyState] = useState<DisplayCurrency>("USD");

  useEffect(() => {
    setCurrencyState(readStored());
  }, []);

  const setCurrency = useCallback((c: DisplayCurrency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore */
    }
  }, []);

  // If AMD was chosen but no rate is configured, show USD.
  const active: DisplayCurrency = currency === "AMD" && amdEnabled ? "AMD" : "USD";

  const format = useCallback(
    (usdCents: number): string => {
      if (active === "AMD" && rate > 0) {
        const amd = Math.round((usdCents / 100) * rate);
        return `֏${amd.toLocaleString()}`;
      }
      return usd(usdCents);
    },
    [active, rate],
  );

  return (
    <CurrencyContext.Provider value={{ currency: active, setCurrency, amdEnabled, rate, format }}>{children}</CurrencyContext.Provider>
  );
}
