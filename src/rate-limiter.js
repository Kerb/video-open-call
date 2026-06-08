class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 100;
    this.windowMs = options.windowMs || 60000;
    this.requests = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  check(identifier) {
    if (!identifier) {
      return true;
    }

    const now = Date.now();
    const userRequests = this.requests.get(identifier);

    if (!userRequests) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs,
        timestamps: [now]
      });
      return true;
    }

    if (now > userRequests.resetTime) {
      userRequests.count = 1;
      userRequests.resetTime = now + this.windowMs;
      userRequests.timestamps = [now];
      return true;
    }

    if (userRequests.count >= this.maxRequests) {
      return false;
    }

    userRequests.count++;
    userRequests.timestamps.push(now);
    return true;
  }

  getStats(identifier) {
    const userRequests = this.requests.get(identifier);
    if (!userRequests) {
      return { count: 0, resetTime: Date.now() + this.windowMs };
    }

    const now = Date.now();
    if (now > userRequests.resetTime) {
      return { count: 0, resetTime: now + this.windowMs };
    }

    return {
      count: userRequests.count,
      resetTime: userRequests.resetTime
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [identifier, data] of this.requests.entries()) {
      if (now > data.resetTime) {
        this.requests.delete(identifier);
      }
    }
  }

  reset(identifier) {
    if (identifier) {
      this.requests.delete(identifier);
    } else {
      this.requests.clear();
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.requests.clear();
  }
}

module.exports = { RateLimiter };