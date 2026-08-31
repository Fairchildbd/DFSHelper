import { createApp } from './api.ts';
import { PORT } from './env.ts';

createApp().listen(PORT, () => {
  console.log(`DFS Matchup API listening on http://localhost:${PORT}`);
});
