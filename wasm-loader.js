// Reassemble the engine as a stream: each hosted asset stays below 25 MiB.
// Only the engine request is intercepted; game data and audio use ordinary fetch.
(() => {
  const originalFetch = window.fetch.bind(window);
  const engineUrl = new URL('index.wasm', location.href).href;
  window.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.href !== engineUrl) return originalFetch(input, options);
    const parts = ['index.wasm.part0', 'index.wasm.part1'];
    let index = 0;
    let reader;
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            if (!reader) {
              if (index === parts.length) { controller.close(); return; }
              const response = await originalFetch(new URL(parts[index++], location.href), options);
              if (!response.ok) throw new Error('The game download was interrupted. Please reload.');
              reader = response.body.getReader();
            }
            const result = await reader.read();
            if (result.done) { reader = null; continue; }
            controller.enqueue(result.value);
            return;
          }
        } catch (error) { controller.error(error); }
      },
      cancel(reason) { return reader?.cancel(reason); }
    }), {headers: {'Content-Type': 'application/wasm'}});
  };
})();
