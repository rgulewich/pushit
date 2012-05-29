/*
 * pushit - pushes files from a git repo to a remote server
 *
 * This contains all of the logic for the CLI
 */


var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var util = require('util');

var MultiError = require('verror').MultiError;
var nopt = require('nopt');
var vasync = require('vasync');

var common = require('./common');
var debug = common.debug;
var hooks = require('./hooks');
var verbose = common.verbose;


var CONFIG = process.env.HOME + '/.pushitrc';
var REPOS = process.env.HOME + '/.pushit-repos';
var DRYRUN = false;

var LONG_OPTS = {
  verbose: Boolean,
  debug: Boolean,
  host: String,
  dryrun: Boolean
};
var SHORT_OPTS = {
  v: '--verbose',
  d: '--debug'
};


var tagRE = new RegExp('%([^%]+)%', 'g');
var funcRE = /^[[]([^\]]+)[\]]/;


//--- Utilities


/*
 * Exits the program with an error message
 */
function exit() {
  console.error.apply(null, Array.prototype.slice.apply(arguments));
  process.exit(1);
}


/*
 * Returns the names of all of the variables in a string as an array
 */
function findVars(str) {
  var vars = [];
  var tag = tagRE.exec(str);
  while (tag != null) {
    vars.push(tag[1]);
    tag = tagRE.exec(str);
  }
  return vars;
}



//--- Push pipeline functions



/*
 * Gets the remote repo name using git
 */
function getGitRepoRemote(state, callback) {
  debug("==> getGitRepoRemote start");
  child_process.exec('git remote -v', function (error, stdout, stderr) {
    if (error) {
      return callback(error);
    }
    if (stdout === '') {
      return callback(new Error("No remote git repo"));
    }

    var lines = stdout.split('\n');
    var line = lines[0];
    var fields = line.split(/\s+/);
    var repo = fields[1];
    if (!repo) {
      return callback(new Error("Could not determine remote git repo"));
    }
    debug("remote git repo='%s'", repo);
    state.repo = repo;
    return callback(null);
  });
}


/*
 * Loads the username and hostname from the config file
 */
function loadConfig(state, callback) {
  debug("==> loadConfig start");
  debug("Loading config from '%s'", CONFIG);
  fs.readFile(CONFIG, function (err, data) {
    if (err) {
      return callback(err);
    }

    var config = JSON.parse(data.toString());
    state.config = config;
    verbose("config: %j", config);

    if (!config.hasOwnProperty('username') ||
        !config.hasOwnProperty('hostname')) {
      // TODO: better error message
      return callback(new Error("Config file is invalid"));
    }

    return callback(null);
  });
}


/*
 * Load the repo data
 */
function loadRepos(state, callback) {
  debug("==> loadRepos start");
  debug("Loading repos file from '%s'", REPOS);
  fs.readFile(REPOS, function (err, data) {
    if (err) {
      return callback(err);
    }

    var repos = JSON.parse(data.toString());
    state.repos = repos;
    debug("repos: %j", repos);

    return callback(null);
  });
}


/*
 * Ensures we're in a remote repo that we know about
 */
function validateRemoteRepo(state, callback) {
  debug("==> validateRemoteRepo start");
  if (!state.repos.hasOwnProperty(state.repo)) {
    return callback(new Error(util.format(
      "Repo '%s' not known: add it to the repos file: %s",
      state.repo, REPOS)));
  }
  return callback(null);
}


/*
 * Gets the top-level directory of this git repo
 */
function getGitTop(state, callback) {
  debug("==> getGitTop start");
  child_process.exec('git rev-parse --show-toplevel', function (error, stdout, stderr) {
    if (error) {
      return callback(error);
    }

    var lines = stdout.split('\n');
    debug("git top-level directory='%s'", lines[0]);
    state.top = lines[0];
    return callback(null);
  });
}


/*
 * Checks that passed-in paths exist, and converts them to relative paths
 */
function resolveLocalPaths(state, callback) {
  debug("==> resolveLocalPaths start");
  vasync.forEachParallel({
    'inputs': state.toPushRaw,
    'func': function (f, cb) {
      fs.stat(f, function(err, stat) {
        if (err) {
          return cb(err);
        }

        var file = path.relative(state.top, f);
        debug("Adding local path '%s'", file);
        state.toPush.push({ path: file, isDir: stat.isDirectory() });

        return cb(null);
      });
    }
  }, function (err, results) {
    if (err) {
      return callback(err);
    }

    return callback(null);
  });
}


/*
 * Determine what needs to be done to satisfy each path (what variables
 * are need, what functions need to be called)
 */
function determineVariableWork(state, callback) {
  debug("==> determineVariableWork start");
  var repo = state.repos[state.repo];
  var errors = [];
  var paths = [];

  for (var p in repo.paths) {
    var fields = repo.paths[p].split('=');
    debug("fields[1]=%s", fields[1]);
    // TODO: support multiple paths separated by a comma
    var pathObj = {
      local: path.relative(state.top, fields[0]),
      remote: fields[1],
      vars: findVars(fields[1]),
      funcs: [],
    };
    if (!pathObj.local) {
      pathObj.local = '.';
    }
    pathObj.re = new RegExp('^' + pathObj.local);

    var seenVars = {};
    processVar = function (pVar, origVar) {
      debug("  processVar: '%s'", pVar);
      if (seenVars.hasOwnProperty(pVar)) {
        debug("    seen '%s', returning", pVar);
        return;
      }

      state.varValues[pVar] = repo.variables[pVar];
      seenVars[pVar] = 1;

      var func = funcRE.exec(pVar);
      if (func) {
        var params = func[1].split(/\s+/g);
        debug("    function: '%s': args=%j", params[0], params.slice(1));
        if (!hooks.hasOwnProperty(params[0])) {
          debug("    function '%s' not found, returning", params[0]);
          errors.push(new Error(
            util.format("Unknown variable '%s'", params[0])));
          return;
        }

        var funcObj = {
          func: params[0],
          args: params.slice(1),
          varName: origVar ? origVar : pVar,
        };
        debug("    function '%s': args=%j, varName=%s",
            funcObj.func, funcObj.args, funcObj.varName);
        pathObj.funcs.unshift(funcObj);

        return true;
      }

      if (!repo.variables.hasOwnProperty(pVar)) {
        debug("    variable '%s' not found, returning", pVar);
        errors.push(new Error(
          util.format("Unknown variable '%s'", pVar)));
        return;
      }

      debug("    variable '%s' found", pVar);
      return true;
    };

    for (var v in pathObj.vars) {
      var vName = pathObj.vars[v];
      debug("path '%s': var='%s'", fields[0], vName);
      if (!processVar(vName)) {
        continue;
      }

      var otherVars = findVars(repo.variables[vName]);
      if (otherVars.length == 0) {
        state.varValues[vName] = vName;
      }

      while (otherVars.length != 0) {
        var oVar = otherVars.shift();
        debug("other var='%s'", oVar);
        if (!processVar(oVar, vName)) {
          continue;
        }

        pathObj.vars.unshift(oVar);
        var varVars = findVars(repo.variables[oVar]);
        if (varVars.length == 0) {
          state.varValues[oVar] = oVar;
        }
        debug ("  varVars=%j", varVars);
        otherVars = otherVars.concat(varVars);
      }
    }
    paths.push(pathObj);
  }

  if (errors.length != 0) {
    return callback(new MultiError(errors));
  }

  state.remotePaths = paths;
  return callback(null);
}


/*
 * Calls any functions needed to fill variable values
 */
function callFunctions(state, callback) {
  debug("==> callFunctions start");
  var errors = [];
  var matchingPaths = [];

  for (var lp in state.toPush) {
    var localPath = state.toPush[lp];
    var matchingPath = null;
    for (var rp in state.remotePaths) {
      var remotePath = state.remotePaths[rp];
      if (remotePath.re.test(localPath.path)) {
        debug("local path '%s' matched remote path '%s'", localPath.path,
          remotePath.local);
        matchingPath = remotePath;
        break;
      }
    }

    if (!matchingPath) {
      errors.push(new Error("No config file paths matched for '%s'", localPath.path));
      continue;
    }
    localPath.matchingPath = matchingPath;
    matchingPaths = matchingPaths.concat(matchingPath.funcs);
  }

  if (errors.length != 0) {
    return callback(new MultiError(errors));
  }

  // First, go through all of the needed functions to get data
  vasync.forEachParallel({
    'inputs': matchingPaths,
    'func': function(curFunc, cb) {
      var funcName = curFunc.func;
      var varName = curFunc.varName;
      var funcVarName = util.format("[%s%s%s]",
        funcName,
        curFunc.args.length != 0 ? " " : "",
        curFunc.args.join(" "));

      if (state.funcValues.hasOwnProperty(funcVarName)) {
        debug("func '%s' (args=%j): already ran, returing",
          funcName, curFunc.args);
        return cb(null);
      }

      var hookHandler = function(e, r) {
        if (e) {
          return cb(new Error(util.format("Function '%s' failed: %s",
              funcName, e.message)));
        }
        debug("function '%s' (args=%j) returned '%s'",
          funcName, curFunc.args, r)

        state.funcValues[funcVarName] = r;
        state.varValues[funcVarName] = r;

        return cb(null);
      };
      var res = hooks[funcName].apply(this,
        [state].concat(curFunc.args).concat(hookHandler));
    }
  }, function (err, res) {
    if (err) {
      return callback(err);
    }
    debug(util.inspect(state));
    return callback(null);
  });
}


/*
 * Expands variables in remote paths, resulting in a set of scp commands
 * stored in state.scpCommands
 */
function expandVariables(state, callback) {
  debug("==> expandVariables start");
  for (var lp in state.toPush) {
    var localPath = state.toPush[lp];
    var remotePath = localPath.matchingPath;

    for (var v in remotePath.vars) {
      var varName = remotePath.vars[v];
      debug("  var='%s'", varName);

      var toExpand = findVars(state.varValues[varName]);
      for (var e in toExpand) {
        var expName = toExpand[e];
        debug("    toExpand: '%s': '%s'", expName, state.varValues[varName]);
        debug("    '%s'=>'%s'", util.format("%%%s%", expName), state.varValues[expName]);
        state.varValues[varName] = state.varValues[varName].replace(
            util.format("%%%s%", expName), state.varValues[expName]);
      }
    }

    var toExpand = findVars(remotePath.remote);
    for (var e in toExpand) {
      var expName = toExpand[e];
      remotePath.remote = remotePath.remote.replace(
          util.format("%%%s%", expName), state.varValues[expName]);
    }
    if (remotePath.remote.indexOf('%') != -1) {
      return callback(new Error(util.format(
          "Found %%: '%s' => '%s'", localPath.path, remotePath.remote)));
    }

    var scpCmd = util.format("scp%s %s %s@%s:%s/%s",
        localPath.isDir ? ' -r' : '',
        localPath.path,
        state.config.username,
        state.config.hostname,
        remotePath.remote,
        localPath.path);

    debug("  scp command: %s", scpCmd);
    state.scpCommands.push(scpCmd);
  }

  return callback(null);
}


/*
 * scp the files to the host
 */
function runScpCommands(state, callback) {
  debug("==> runScpCommands start");
  vasync.forEachParallel({
    'inputs': state.scpCommands,
    'func': function(cmd, cb) {
      verbose("# " + cmd);

      child_process.exec(cmd, function (err, stdout, stderr) {
        if (err) {
          return cb(err);
        }
        return cb(null);
      });
    },
  }, function (err, results) {
    if (err) {
      return callback(err);
    }

    return callback(null);
  });
}


//--- Entry functions


/*
 * Sets the hostname and username to push to
 */
function setHost(host) {
  var fields = host.split('@');
  if (fields.length != 2) {
    exit("Host is not in format 'username@hostname'");
  }
  var config = { username: fields[0], hostname: fields[1] };
  debug("Writing config to '%s': %j", CONFIG, config);
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
}


/*
 * Pushes the specified files to the configured server
 */
function push(opts) {
  var state = {
    toPushRaw: opts.argv.remain,
    toPush: [],
    varValues: {},
    funcValues: {},
    scpCommands: []
  };
  vasync.pipeline({
    'arg': state,
    'funcs': [
      getGitRepoRemote,
      loadConfig,
      loadRepos,
      validateRemoteRepo,
      getGitTop,
      resolveLocalPaths,
      determineVariableWork,
      callFunctions,
      expandVariables,
      runScpCommands
    ],
  }, function (err, res) {

    debug(util.inspect(state));

    if (err) {
      if (err.hasOwnProperty('ase_errors')) {
        for (var e in err.ase_errors) {
          console.error(err.ase_errors[e].message);
        }
      } else {
        console.error(err.message);
      }
    } else {
      verbose("Push completed successfully.");
    }
  });
}


/*
 * Main entry point
 */
function main() {
  var parsedOpts = nopt(LONG_OPTS, SHORT_OPTS, process.argv, 2);
  if (parsedOpts.verbose)
    common.setVerbose(true);
  if (parsedOpts.debug)
    common.setDebug(true);
  if (parsedOpts.dryrun)
    DRYRUN = true;

  if (parsedOpts.hasOwnProperty('host')) {
    return setHost(parsedOpts.host);
  }

  push(parsedOpts);
}


main();
