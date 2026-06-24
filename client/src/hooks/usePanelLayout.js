import { useMemo } from 'react';

/**
 * usePanelLayout
 *
 * Maps the current game stage + element state to panel visibility config.
 * Each entry describes which edge the panel enters/exits from, its flex weight
 * (used to share space proportionally when both panels are visible), and a
 * minimum width.
 *
 * Returned layout:
 * {
 *   activeElement: { visible, enterFrom, exitTo, flexWeight, minWidth, duration, ease },
 *   leaderboard:   { visible, enterFrom, exitTo, flexWeight, minWidth, duration, ease, fullWidth },
 *   footer:        { visible, enterFrom, exitTo, duration, ease },
 * }
 */

// Feature-level size hints for the active element panel
export const FEATURE_CONFIGS = {
  wheel:       { flexWeight: 1.5, minWidth: 500 },
  vote:        { flexWeight: 0.85, minWidth: 380 },
  payout:      { flexWeight: 1.0, minWidth: 420 },
  elimination: { flexWeight: 1.2, minWidth: 480 },
};

const DEFAULT_DURATION = 0.6;
const DEFAULT_EASE = 'power2.inOut';

export function usePanelLayout({ currentStage, activeElementType }) {
  return useMemo(() => {
    const hasActive = !!activeElementType;
    const featureCfg = FEATURE_CONFIGS[activeElementType] ?? { flexWeight: 1.0, minWidth: 420 };

    const leaderboard = {
      visible: true,
      enterFrom: 'right',
      exitTo: 'right',
      flexWeight: 1.0,
      minWidth: 460,
      duration: DEFAULT_DURATION,
      ease: DEFAULT_EASE,
      fullWidth: !hasActive,
    };

    const activeElement = {
      visible: hasActive,
      enterFrom: 'left',
      exitTo: 'left',
      flexWeight: featureCfg.flexWeight,
      minWidth: featureCfg.minWidth,
      duration: DEFAULT_DURATION,
      ease: DEFAULT_EASE,
    };

    return { activeElement, leaderboard };
  }, [currentStage, activeElementType]);
}
