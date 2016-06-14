# Horizon plugins

Plugins are intended to allow the horizon backend to be extended in a
modular way, giving users of horizon new capabilities with a minimum
of configuration.

Plugins are intended to be flexible enough to implement things like:

 - GraphQL endpoints #125)
 - REST endpoints (#510)
 - Custom horizon commands (#337)
 - Custom authentication methods (#428)
 - Server side rendering (#249)
 - Worker processes (#368)
 - Scheduled tasks (#311)

## Things plugins can do
 - Add new configuration options
 - Add new `hz` commands
 - Add new http endpoints
 - Add new horizon request types useable by the client

## Plugin interface
 - NPM modules with the keyword 'horizon-plugin'
 - export an object with the name 'plugin' that has one or more of the
   following properties defined on it:
   - `name`: a name for the plugin. Defaults to the package name
   - `commands` for extending the `hz` command line tool [commands](#commands)
   - `processes`: specifies subprocesses to spawn [processes](#processes)
   - `endpoints`: specifies http endpoints that will be owned by the plugin [endpoints](#endpoints)
   - `config`: specifies new configuration options [config](#config)
   - `env`: specifies environment variables the plugin cares about [environment vars](#environment-vars)
   - `requests`: specified new request types to accept over the websocket connection [requests](#requests)
   - `activate`: Called once before the plugin is activated [activate](#activate)
   - `deactivate`: Called once before the plugin is deactivated [deactivate](#deactivate)

### Commands

The `commands` plugin property must be an object with the following
properties:
  - `name`: a string with the name of the command to
    implement. Defaults to an underscore-to-hyphen converted version
    of the npm package name of the plugin
  - `helpText`: a short description of what the command does. Mandatory.
  - `addArguments`: a function that receives the
    [argparse parser](http://nodeca.github.io/argparse/#HelpFormatter.prototype.addArgument)
    for the current command, and adds any options to that parser. This
    can include creating
    [subparsers](http://nodeca.github.io/argparse/#ArgumentParser.prototype.addSubparsers)
    - default is a no-op function
  - `processConfig`: a function that receives:
   1. the final result of the parsed options from the command line
   2. an object representing the plugin's [config options](#config) that were in the config.toml file
   3. an object with the values of any environment variables the plugin cares about
    any. It returns the final options, merging command line and config
    options any way it wants to.
    - default is a function that merges the config, env and command
      line arguments in a precedence order the same way built in
      commands do.
  - `runCommand`: a function that receives the merged result of
    `processConfig` as its first argument and a `done` function as its
    second argument. It should execute its task, calling `done` with an error if something goes wrong.
    - Note: it should *not* call `process.exit`.
    - Mandatory option, since this is the entire point of the command.

Note that the command will not ever have `activate` or `deactivate`
called, those functions are for server plugins.

### Config

The `config` plugin property specifies which config options
will be forwarded from the config file section for the plugin.

So a `config` key like:

```js
{
  name: 'my-plugin-name',
  config: {
    someKey: 'boolean',
    some_other_key: 'string',
  }
}
```

Will allow the following section in `config.toml`:

```toml
[plugin.my-plugin-name]
someKey = true
some_other_key = 'some kinda string'
```

The values from this config section will be passed to both the
`processConfig` function for commands, as well as the
[`activate`](#activate) function for server plugins. The object passed
will look like:

```js
{ someKey: true, some_other_key: 'some_kinda_string' }
```

### Endpoints

The `endpoints` plugin property is an object with keys that correspond
to endpoints the plugin will be responsible for, and values that are
functions that handle requests to that endpoint. The functions receive
three arguments:
 - An Express `request` object
 - An Express `response` object
 - A state object of whatever kind is returned by the plugin's
   [activate](#activate) function

The handler should deal with whatever HTTP methods come to the route.

Example:

```js
{
  endpoints: {
    'hello-world': (req, res, state) => {
      res.send(`Hello ${state.value}`);
      res.end()
    },
    'set-world': (req, res, state) => {
      state.value = req.body
      res.end()
    }
  }
}
```

Notes:
 - The endpoint is responsible for calling `res.end()`.
 - The route is a hard-prefix from the root of the horizon server address.
  - It cannot clash with any other plugin routes (no overlapping)
  - It cannot clash with the route horizon itself (usually `"horizon"`)
 - Express 4.0

### Processes

### Environment vars

### Requests

### Activate

### Deactivate

The plugin is required to completely clean itself up in the
`deactivate` function, leaving no state behind.
