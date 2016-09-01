'use strict';

const Request = require('./request');
const Toposort = require('toposort-class');
const EventEmitter = require('events');

class PluginRouter extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.httpRoutes = {};
    this.methods = {};

    this.plugins = new Map();
    this.readyPlugins = new Set();
  }

  noteReady(plugin) {
    if (!this.readyPlugins.has(plugin)) {
      console.log(`noteReady(${plugin}): ${this.readyPlugins.size}/${this.plugins.size}`);
      this.readyPlugins.add(plugin);
      this.emit('pluginReady', plugin, this);
      if (this.readyPlugins.size === this.plugins.size) {
        setImmediate(() => this.emit('ready', this));
      }
    }
  }

  noteUnready(plugin) {
    if (this.readyPlugins.has(plugin)) {
      console.log(`noteUnready(${plugin}): ${this.readyPlugins.size}/${this.plugins.size}`);
      this.readyPlugins.delete(plugin);
      this.emit('pluginUnready', plugin, this);
      if (this.readyPlugins.size === this.plugins.size - 1) {
        this.emit('unready', this);
      }
    }
  }

  add(plugin) {
    if (this.plugins.has(plugin.name)) {
      return Promise.reject(
        new Error(`Plugin conflict: "${plugin.name}" already present.`));
    }
    // Placeholder so we don't say we're ready too soon
    this.plugins.set(plugin.name, null);
    this.plugins.set(plugin.name, Promise.resolve(this.server).then((server) => {
      this.emit('unready', this);
      if (plugin.activate.length > 1) {
        console.log(`activating ${plugin.name} with ready callbacks`);
        return plugin.activate(
          server,
          () => this.noteReady(plugin.name),
          () => this.noteUnready(plugin.name));
      } else {
        return Promise.resolve().then(() => plugin.activate(server)).then((x) => {
          this.noteReady(plugin.name);
          return x;
        });
      }
    }).then((active) => {
      if (this.httpRoutes[plugin.name]) {
        throw new Error(`Plugin conflict: "${plugin.name}" already present.`);
      }

      for (const m in active.methods) {
        console.log(`adding plugin method: ${m}`);
        if (this.methods[m]) {
          throw new Error(`Method name conflict: "${m}"`);
        }
      }

      this.httpRoutes[plugin.name] = active;
      for (const m in active.methods) {
        this.methods[m] = active.methods[m];
        this._requirementsOrdering = null;
      }
    }));
    return this.plugins.get(plugin.name);
  }

  remove(plugin, reason) {
    if (!this.plugins.has(plugin.name)) {
      return Promise.reject(new Error(`Plugin "${plugin.name}" is not present.`));
    }
    return this.plugins.get(plugin.name).then((active) => {
      for (const m in active.methods) {
        delete this.methods[m];
        this._requirementsOrdering = null;
      }
      if (plugin.deactivate) {
        plugin.deactivate(reason || 'Removed from PluginRouter.');
      }
    });
  }

  requirementsOrdering() {
    // RSI: move dependencies and topological sorting into the server
    if (!this._requirementsOrdering) {
      this._requirementsOrdering = {};

      const topo = new Toposort();
      for (const m in this.methods) {
        const reqs = this.methods[m].requires;
        if (reqs) {
          topo.add(m, reqs);
          for (const r of reqs) {
            if (!this.methods[r]) {
              throw new Error(
                `Missing method "${r}", which is required by method "${m}".`);
            }
          }
        }
      }

      this._requirementsOrdering = topo.sort().reverse();
    }
    return this._requirementsOrdering;
  }

  httpMiddleware() {
    return (req, res, next) => {
      const pathParts = req.path.split('/');
      const name = pathParts[0] || pathParts[1];
      const plugin = this.httpRoutes[name];
      if (plugin && plugin.httpRoute) {
        plugin.httpRouter(req, res, next);
      } else {
        next();
      }
    };
  }

  hzMiddleware() {
    return (req, res, next) => {
      let terminalName = null;
      const requirements = {};
      if (req.options) {
        for (const o in req.options) {
          const m = this.methods[o];
          if (m) {
            console.log(`method for request: ${o}, type: ${m.type}`);
            if (m.type === 'terminal') {
              if (terminalName !== null) {
                next(new Error('multiple terminals in request: ' +
                               `${terminalName}, ${o}`));
              } else {
                terminalName = o;
              }
            } else {
              requirements[o] = true;
            }
            if (m.requires) {
              for (const r of m.requires) {
                requirements[r] = true;
              }
            }
          } else {
            console.log(`no ${o} method for request`);
          }
        }
      }

      if (terminalName === null) {
        next(new Error('no terminal in request'));
      } else if (requirements[terminalName]) {
        next(new Error('terminal ${terminalName} is also a requirement'));
      } else {
        const ordering = this.requirementsOrdering();
        const middlewareChain = Object.keys(requirements).sort(
          (a, b) => ordering[a] - ordering[b]);
        middlewareChain.push(terminalName);

        middlewareChain.reduceRight((cb, methodName) =>
          (maybeErr) => {
            if (maybeErr instanceof Error) {
              next(maybeErr);
            } else {
              try {
                this.methods[methodName].handler(new Request(req, methodName), res, cb);
              } catch (e) {
                next(e);
              }
            }
          }, next)();
      }
    };
  }
}

module.exports = PluginRouter;

