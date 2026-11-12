import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2] ?? 'campground-lake';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9453 });
await waitForGame(cdp);
console.log(cdp.consoleLines.filter((l) => /water|dredge/.test(l)).join('\n') || '(no water log)');
await cdp.close();
