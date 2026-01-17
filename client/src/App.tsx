// Import types from shared to verify TypeScript integration
import type { GameView } from '@ccu/shared'

// Verify type import works (used in component)
const _: GameView | null = null;
void _; // suppress unused warning

function App() {
  return (
    <div>
      <h1>Chess Clock UNO</h1>
      <p>Lobby coming soon...</p>
    </div>
  )
}

export default App
