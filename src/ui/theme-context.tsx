import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_THEME_ID, themeById, type Theme, type ThemeId } from "./themes.ts";

/**
 * The chosen palette, remembered.
 *
 * Reads from storage once on mount and renders the default until it arrives. A brief flash of the
 * default beats blocking the first frame on a disk read — and on a wallet, the first frame is
 * someone checking a balance.
 */
const KEY = "arc.appearance";

const ThemeContext = createContext<{ theme: Theme; setTheme: (id: ThemeId) => void }>({
  theme: themeById(DEFAULT_THEME_ID),
  setTheme: () => {},
});

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME_ID);

  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((stored) => {
      if (stored !== null) setId(themeById(stored).id);
    });
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setId(next);
    // Fire and forget: the screen has already changed, and a failed write costs a preference, not
    // money. Surfacing it would be noise at the exact moment someone is looking at something else.
    void AsyncStorage.setItem(KEY, next);
  }, []);

  const value = useMemo(() => ({ theme: themeById(id), setTheme }), [id, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useAppearance(): { theme: Theme; setTheme: (id: ThemeId) => void } {
  return useContext(ThemeContext);
}
