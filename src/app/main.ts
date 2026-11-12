import './styles.css';
import { Game } from '../game/core/Game';
import { AudioEngine } from './audio/AudioEngine';

async function bootstrap(): Promise<void> {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    console.error('Fatal: #app container not found in DOM.');
    return;
  }

  const loadingScreen = document.getElementById('loading-screen');
  const loadingProgress = document.getElementById('loading-progress');

  // Pre-initialize procedural audio engine on first interaction
  const audio = AudioEngine.getInstance();
  const unlockAudio = () => {
    audio.ensureContext();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  try {
    if (loadingProgress) loadingProgress.textContent = 'Initializing 3D Engine...';
    const game = new Game(appContainer);

    await game.initialize((statusMessage) => {
      if (loadingProgress) {
        loadingProgress.textContent = statusMessage;
      }
    });

    if (loadingScreen) {
      loadingScreen.classList.add('fade-out');
      setTimeout(() => {
        loadingScreen.remove();
      }, 500);
    }
  } catch (err) {
    console.error('Fatal initialization error:', err);
    if (loadingProgress) {
      loadingProgress.textContent = `Error loading game: ${err instanceof Error ? err.message : String(err)}`;
      loadingProgress.style.color = '#ff4444';
    }
  }
}

// Safely execute bootstrap whether document is still loading or already parsed
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    bootstrap().catch(console.error);
  });
} else {
  bootstrap().catch(console.error);
}
