import { useState, useEffect, Component } from 'react';
import io from 'socket.io-client';
import PlayerView from './views/PlayerView';
import HostView from './views/HostView';
import HostControls from './views/HostControls';

const socket = io();

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#e74c3c', fontFamily: 'monospace', background: '#1a0000', minHeight: '100vh' }}>
          <h2 style={{ color: '#ff6b6b' }}>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#ffaaaa' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 20px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      return <ErrorBoundary><HostView gameState={gameState} socket={socket} /></ErrorBoundary>;
    case 'host-controls':
      return <ErrorBoundary><HostControls gameState={gameState} socket={socket} /></ErrorBoundary>;
    default:
      return <ErrorBoundary><PlayerView gameState={gameState} socket={socket} /></ErrorBoundary>;
  }
}

export default App;