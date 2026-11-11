/*
    ERP System - Event Emitter Service
    Enables inter-module communication via events
    Example: When a sale is made in POS, emit "sale.completed" event
    CustomerLogs module listens and updates loyalty points
*/

class EventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(eventName, callback) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(callback);
  }

  off(eventName, callback) {
    if (!this.listeners[eventName]) return;
    this.listeners[eventName] = this.listeners[eventName].filter(cb => cb !== callback);
  }

  async emit(eventName, data) {
    if (!this.listeners[eventName]) return;
    
    for (const callback of this.listeners[eventName]) {
      try {
        await callback(data);
      } catch (error) {
        console.error(`❌ Error handling event ${eventName}:`, error);
      }
    }
  }

  once(eventName, callback) {
    const wrapper = async (data) => {
      await callback(data);
      this.off(eventName, wrapper);
    };
    this.on(eventName, wrapper);
  }
}

export default new EventEmitter();
