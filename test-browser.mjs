// test-browser.mjs
async function run() {
  const versionRes = await fetch('http://127.0.0.1:9222/json/list');
  const pages = await versionRes.json();
  const page = pages.find(p => p.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) {
    console.error('No page found');
    return;
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const requests = new Map();

  function send(method, params = {}) {
    const msgId = id++;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return msgId;
  }

  ws.onopen = () => {
    send('Runtime.enable');
    send('Console.enable');
    send('Log.enable');
    send('Page.enable');
    send('Network.enable');
    setTimeout(() => {
      send('Page.navigate', { url: 'http://localhost:1420' });
    }, 500);
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      const args = data.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
      console.log(`[CONSOLE ${data.params.type.toUpperCase()}]`, args);
    } else if (data.method === 'Runtime.exceptionThrown') {
      console.error('[EXCEPTION]', JSON.stringify(data.params.exceptionDetails));
    } else if (data.method === 'Network.requestWillBeSent') {
      requests.set(data.params.requestId, data.params.request.url);
      console.log('[REQ]', data.params.request.url);
    } else if (data.method === 'Network.responseReceived') {
      console.log('[RES]', data.params.response.status, data.params.response.url);
    } else if (data.method === 'Network.loadingFailed') {
      const url = requests.get(data.params.requestId);
      console.error('[NET FAIL]', data.params.errorText, url);
    } else if (data.method === 'Log.entryAdded') {
      console.log('[LOG ENTRY]', data.params.entry.text);
    }
  };

  await new Promise(r => setTimeout(r, 6000));

  // Evaluate document.body.innerHTML or progress text
  send('Runtime.evaluate', {
    expression: 'JSON.stringify({ progress: document.getElementById("loading-progress")?.textContent, appChildren: document.getElementById("app")?.children.length, body: document.body.innerHTML })'
  });

  await new Promise((resolve) => {
    const origOnMsg = ws.onmessage;
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.result && d.result.result) {
        console.log('[EVAL RESULT]', d.result.result.value);
        resolve();
      } else if (origOnMsg) {
        origOnMsg(e);
      }
    };
    setTimeout(resolve, 3000);
  });

  ws.close();
}

run().catch(console.error);
