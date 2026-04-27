import { createContext, useContext } from 'react';

/**
 * Provides the current animation progress (0–1) of the nearest AnimatedPanel ancestor.
 * Children that need to gate behavior on visibility consume this context.
 *
 * progress      – 0 = fully hidden, 1 = fully visible
 * isFullyVisible – true when progress >= 0.98
 */
export const PanelProgressContext = createContext({ progress: 0, isFullyVisible: false });

export function usePanelProgress() {
  return useContext(PanelProgressContext);
}
