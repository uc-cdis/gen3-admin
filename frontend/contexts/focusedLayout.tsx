import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Lets a page ask for the app chrome to get out of the way.
 *
 * The navbar and breadcrumbs exist to move around *within* an environment.
 * Before one is chosen they are dead weight -- the sidebar renders "Please
 * select a cluster" next to a page whose entire job is selecting a cluster,
 * and the breadcrumb is a lone "Home". Worse, they squeeze the content that
 * does matter into a narrow column.
 *
 * Pages that own the whole viewport (the environment chooser, the setup
 * wizard) call `useFocusedLayout(true)` and `_app` drops the chrome.
 *
 * Deliberately context rather than a static page property: the landing page
 * decides between a chooser and a dashboard at render time, so the answer is
 * not known statically.
 */

type FocusedLayoutContextValue = {
  focused: boolean;
  setFocused: (value: boolean) => void;
};

const FocusedLayoutContext = createContext<FocusedLayoutContextValue | null>(null);

export function FocusedLayoutProvider({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const value = useMemo(() => ({ focused, setFocused }), [focused]);

  return <FocusedLayoutContext.Provider value={value}>{children}</FocusedLayoutContext.Provider>;
}

/** Read the current state. Used by `_app` to decide what chrome to render. */
export function useFocusedLayoutState(): boolean {
  return useContext(FocusedLayoutContext)?.focused ?? false;
}

/**
 * Declare whether the calling page wants the focused layout.
 *
 * Reverts on unmount, so navigating away always restores the normal shell
 * even if the page unmounts mid-transition.
 */
export function useFocusedLayout(active: boolean): void {
  const setFocused = useContext(FocusedLayoutContext)?.setFocused;

  useEffect(() => {
    setFocused?.(active);
    return () => setFocused?.(false);
  }, [active, setFocused]);
}
