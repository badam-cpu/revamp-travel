/**
 * Display-currency switcher (AMD / USD). The marketplace is AMD-primary: prices
 * are stored, charged, and SETTLED in Armenian dram (PayLink charges AMD), and
 * all accounting is AMD. This is a presentation layer only — USD is a display
 * reference converted from the AMD amount at the admin-set rate
 * (site_settings.usd_to_amd_rate = AMD per 1 USD, via SiteSettingsContext).
 * Choosing USD never changes what's charged; checkout notes that AMD is the
 * settlement currency when USD is shown.
 *
 * Every money amount handed to `format()` is in AMD "cents" (hundredths of a
 * dram — see shared/bookings.ts). AMD is shown as whole drams (no minor unit);
 * USD is shown with cents. The viewer's choice is remembered in localStorage.
 * USD is only offered when a rate is set (> 0); otherwise only AMD is shown.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";

export type DisplayCurrency = "AMD" | "USD";
const STORAGE_KEY = "revamp.displayCurrency";

interface CurrencyContextValue {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  /** True when a rate is configured, so the USD reference (and the switcher) can be shown. */
  switchable: boolean;
  rate: number; // AMD per 1 USD (0 = unset)
  /** Format an amount given in AMD cents (hundredths of a dram) into the active display currency. */
  format: (amdCents: number) => string;
}

function amd(cents: number): string {
  // Round the DISPLAYED figure to the nearest 100 drams for a clean look — the
  // stored/charged amount is untouched (many prices are non-round because
  // migration 0020 converted them from USD at the exchange rate).
  const drams = Math.round(cents / 100 / 100) * 100;
  return `֏${drams.toLocaleString()}`;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "AMD",
  setCurrency: () => {},
  switchable: false,
  rate: 0,
  format: amd,
});

export const useCurrency = () => useContext(CurrencyContext);

function readStored(): DisplayCurrency {
  try {
    return localStorage.getItem(STORAGE_KEY) === "USD" ? "USD" : "AMD";
  } catch {
    return "AMD";
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { settings } = useSiteSettings();
  const rate = settings.usdToAmdRate || 0;
  const switchable = rate > 0;
  const [currency, setCurrencyState] = useState<DisplayCurrency>("AMD");

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

  // If USD was chosen but no rate is configured, fall back to AMD.
  const active: DisplayCurrency = currency === "USD" && switchable ? "USD" : "AMD";

  const format = useCallback(
    (amdCents: number): string => {
      if (active === "USD" && rate > 0) {
        // Whole numbers only — no cents (matches the AMD display).
        const usd = Math.round(amdCents / 100 / rate);
        return `$${usd.toLocaleString()}`;
      }
      return amd(amdCents);
    },
    [active, rate],
  );

  return (
    <CurrencyContext.Provider value={{ currency: active, setCurrency, switchable, rate, format }}>{children}</CurrencyContext.Provider>
  );
}
