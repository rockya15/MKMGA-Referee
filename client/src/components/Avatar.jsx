import { useMemo } from 'react';

/**
 * Avatar Component
 * 
 * Displays a player's profile image or a color-coded fallback with their initial.
 * Used throughout the app for consistent avatar rendering.
 * 
 * Props:
 *  - player: player object with profileImageUrl, displayName, realName, favoriteColor
 *  - size: numeric size in pixels (default: 64)
 *  - showInitial: show the initial on fallback (default: true)
 *  - borderWidth: border width in pixels (default: 2)
 *  - borderColor: border color (default: inherited from favorite color or '#555')
 *  - style: additional inline styles to apply
 *  - getFavoriteColor: function to get the player's favorite color (receives player object)
 */
export default function Avatar({
  player,
  size = 64,
  showInitial = true,
  borderWidth = 2,
  borderColor = null,
  style = null,
  getFavoriteColor,
}) {
  if (!player) return null;

  const initial = useMemo(() => {
    return (player.displayName || player.realName || '?')[0]?.toUpperCase() ?? '?';
  }, [player.displayName, player.realName]);

  const favoriteColor = getFavoriteColor?.(player) ?? '#2a2a4a';
  const finalBorderColor = borderColor ?? favoriteColor;

  const baseStyles = {
    width: size,
    height: size,
    borderRadius: '50%',
    objectFit: 'cover',
    border: `${borderWidth}px solid ${finalBorderColor}`,
    flexShrink: 0,
  };

  if (player.profileImageUrl) {
    return (
      <img
        src={player.profileImageUrl}
        alt={player.displayName || player.realName || 'Avatar'}
        style={{ ...baseStyles, ...style }}
      />
    );
  }

  return (
    <div
      style={{
        ...baseStyles,
        background: favoriteColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.floor(size * 0.35),
        fontWeight: 'bold',
        color: '#e8ecf6',
        ...style,
      }}
    >
      {showInitial ? initial : ''}
    </div>
  );
}
