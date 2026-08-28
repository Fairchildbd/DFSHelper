import { createApp } from './api.ts';
import { PORT } from './env.ts';

createApp().listen(PORT, () => {
  console.log(`DFSHelper API listening on http://localhost:${PORT}`);
});
