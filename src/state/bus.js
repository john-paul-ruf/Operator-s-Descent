const handlers = new Map();

export const bus = {
  on(event, handler) {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event).add(handler);
    return () => handlers.get(event)?.delete(handler);
  },
  dispatch(event, payload) {
    const eventHandlers = handlers.get(event);
    if (eventHandlers) {
      eventHandlers.forEach((h) => {
        try { h(payload); } catch (e) { console.error(`Bus handler error for ${event}:`, e); }
      });
    }
  }
};