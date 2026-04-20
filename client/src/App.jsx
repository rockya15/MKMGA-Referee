import { useState, useEffect } from 'react';
import io from 'socket.io-client';
import PlayerView from './views/PlayerView';
import HostView from './views/HostView';
import HostControls from './views/HostControls';

const socket = io();

function App() {
  const [gameState, setGameState] = useState(null);
  const [role, setRole] = useState(null); // 'player', 'host', 'host-controls'

  useEffect(() => {
    socket.on('game-state', (state) => {
      setGameState(state);
    });

    // Determine role based on URL or something
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    if (view === 'host') {
      setRole('host');
    } else if (view === 'host-controls') {
      setRole('host-controls');
    } else {
      setRole('player');
    }

    return () => {
      socket.off('game-state');
    };
  }, []);

  if (!gameState) {
    return <div>Loading...</div>;
  }

  switch (role) {
    case 'host':
      return <HostView gameState={gameState} socket={socket} />;
    case 'host-controls':
      return <HostControls gameState={gameState} socket={socket} />;
    default:
      return <PlayerView gameState={gameState} socket={socket} />;
  }
}

export default App;