import Avatar from './Avatar';

/**
 * StackedAvatars Component
 * 
 * Displays multiple avatars stacked behind each other.
 * Used in the position grid to show which players are assigned to each position.
 * 
 * Props:
 *  - players: array of player objects to display
 *  - size: size of the largest (front) avatar in pixels (default: 48)
 *  - maxDisplay: maximum number of avatars to show (default: 3)
 *  - stackOffset: pixel offset between stacked avatars (default: -12)
 *  - getFavoriteColor: function to get the player's favorite color
 */
export default function StackedAvatars({
  players = [],
  size = 48,
  maxDisplay = 3,
  stackOffset = -12,
  getFavoriteColor,
}) {
  if (!players || players.length === 0) {
    return null;
  }

  const displayed = players.slice(0, maxDisplay);
  const overflow = players.length - displayed.length;

  return (
    <div
      style={{
        position: 'relative',
        width: size + (displayed.length - 1) * Math.abs(stackOffset),
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      {displayed.map((player, index) => (
        <div
          key={player.id}
          style={{
            position: 'absolute',
            right: index * Math.abs(stackOffset),
            zIndex: displayed.length - index,
          }}
          title={player.displayName || player.realName || 'Unknown'}
        >
          <Avatar
            player={player}
            size={size}
            borderWidth={2}
            borderColor="#fff"
            getFavoriteColor={getFavoriteColor}
          />
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{
            position: 'absolute',
            right: displayed.length * Math.abs(stackOffset),
            zIndex: 0,
            fontSize: Math.floor(size * 0.4),
            fontWeight: 'bold',
            color: '#aaa',
            background: '#333',
            width: size,
            height: size,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #555',
          }}
          title={`+${overflow} more`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
