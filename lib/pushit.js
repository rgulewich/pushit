/*
 * pushit - pushes files from a git repo to a remote server
 *
 * CLI entry points
 */

var common = require('./common');
var cp = require('child_process');
var dashdash = require('dashdash');
var debug = common.debug;
var fmt = require('util').format;
var fs = require('fs');
var hooks = require('./hooks');
var MultiError = require('verror').MultiError;
var path = require('path');
var util = require('util');
var vasync = require('vasync');
var verbose = common.verbose;
var VError = require('verror').VError;



// --- Globals



var COLOUR_END = '\033[39m';
var COLOUR_GREEN = '\033[32m';
var COLOUR_RED = '\033[31m';
var CONFIG = process.env.HOME + '/.pushitrc';
var REPOS = process.env.HOME + '/.pushit-repos';
var DRYRUN = false;
// dashdash options
var OPTS = [
    {
        names: [ 'all', 'a' ],
        type: 'bool',
        help: 'Push all changed files.'
    },
    {
        names: [ 'host', 'h' ],
        type: 'string',
        help: 'Set the destination host.'
    },
    {
        names: [ 'default', 'd' ],
        type: 'string',
        help: 'Save the default host. Running without --host will '
            + ' push to the default host.'
    },
    {
        names: [ 'show-default' ],
        type: 'bool',
        help: 'Print the default host.'
    },
    {
        names: [ 'help', '?' ],
        type: 'bool',
        help: 'Print this help and exit.'
    },
    {
        names: [ 'repo' ],
        type: 'bool',
        help: 'Print the current repo, for setting in ~/.pushit-repos'
    },
    {
        names: [ 'dryrun' ],
        type: 'bool',
        help: 'Print out files to copy, but don\'t actually scp them.'
    },
    {
        names: [ 'debug' ],
        type: 'bool',
        help: 'Output debug information.'
    },
    {
        names: [ 'verbose', 'v' ],
        type: 'bool',
        help: 'Verbose output.'
    }
];
var tagRE = new RegExp('%([^%]+)%', 'g');
var funcRE = /^[[]([^\]]+)[\]]/;



// --- Utilities



/*
 * Exits the program with an error message
 */
function exit() {
    printErr.apply(null, arguments);
    process.exit(1);
}


/*
 * Usage
 */
function usage(parser) {
    console.log([
        'Usage:',
        '    pushit [options] --host <user@hostname> <files>',
        '    pushit [options] --host <user@hostname> -a',
        '    pushit [options] --default <user@hostname>',
        '    pushit [options] <files>',
        '    pushit [options] -a',
        '',
        'Options:'
    ].join('\n') + '\n'
        + parser.help({includeEnv: true}).trimRight()
    );

    process.exit(0);
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


/**
 * Returns an ANSI colourised error string
 */
function errStr() {
    return COLOUR_RED + 'Error: ' + COLOUR_END
        + fmt.apply(null, Array.prototype.slice.apply(arguments));
}


/**
 * Returns an ANSI colourised OK (success) string
 */
function okStr() {
    return COLOUR_GREEN
        + fmt.apply(null, Array.prototype.slice.apply(arguments))
        + COLOUR_END;
}


/**
 * Prints out a colourised error string
 */
function printErr() {
    return console.error(errStr.apply(null, arguments));
}



// --- Push pipeline functions



/*
 * Gets the remote repo name using git
 */
function getGitRepoRemote(state, callback) {
    debug('==> getGitRepoRemote start');
    var cmd = 'git remote -v';

    cp.exec(cmd, function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }
        if (stdout === '') {
            return callback(new Error(cmd + ': no remote git repo'));
        }

        var lines = stdout.split('\n');
        var line = lines[0];
        var fields = line.split(/\s+/);
        var repo = fields[1];
        if (!repo) {
            return callback(new Error(
                cmd + ': could not determine remote git repo'));
        }

        debug('remote git repo="%s"', repo);
        state.repo = repo;
        return callback(null);
    });
}


/*
 * Loads the username and hostname from the config file
 */
function loadConfig(state, callback) {
    debug('==> loadConfig start');

    // If we've passed in a host, don't bother loading the config
    if (state.toHost) {
        return callback();
    }

    debug('Loading config from "%s"', CONFIG);

    fs.readFile(CONFIG, function (err, data) {
        if (err) {
            if (err.code == 'ENOENT') {
                return callback(new VError(
                    'Config file "%s" does not exist. Create it with '
                    + '"pushit --host username@hostname"', CONFIG));
            }

            return callback(err);
        }

        state.config = JSON.parse(data.toString());
        verbose('config: %j', state.config);

        if (!state.config.hasOwnProperty('defaultHost')) {
            return callback(new Error(
                'Config file is missing the "defaultHost" property: '
                + 'set it with "pushit --default myhostname"'
                ));
        }

        return callback(null);
    });
}


/*
 * Loads the hostname from state.toHost (set by the --host option) if set,
 * or defaultHost in the config file
 */
function setToHost(state, callback) {
    debug('==> setToHost start');

    if (state.toHost) {
        return callback();
    }

    state.toHost = state.config.defaultHost;
    return callback();
}


/*
 * Load the repo data
 */
function loadRepos(state, callback) {
    debug('==> loadRepos start');
    debug('Loading repos file from "%s"', REPOS);

    fs.readFile(REPOS, function (err, data) {
        if (err) {
            if (err.code == 'ENOENT') {
                return callback(new VError(
                    'Repo file "%s" does not exist.', REPOS));
            }

            return callback(err);
        }

        state.repos = JSON.parse(data.toString());
        debug('repos: %j', state.repos);

        return callback(null);
    });
}


/*
 * Ensures we're in a remote repo that we know about
 */
function validateRemoteRepo(state, callback) {
    debug('==> validateRemoteRepo start');

    if (!state.repos.hasOwnProperty(state.repo)) {
        return callback(new VError(
        'Repo "%s" not known: add it to the repos file: %s',
        state.repo, REPOS));
    }

    return callback(null);
}


/*
 * Gets the top-level directory of this git repo
 */
function getGitTop(state, callback) {
    debug('==> getGitTop start');

    cp.exec('git rev-parse --show-toplevel', function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }

        var lines = stdout.split('\n');
        debug('git top-level directory="%s"', lines[0]);
        state.top = lines[0];
        return callback(null);
    });
}


/*
 * If --all was specified, figure out which files were modified in this repo
 */
function getAllFromGit(state, callback) {
    debug('==> getAllFromGit start');

    if (!state.pushAll) {
        debug('  --all not specified: not getting all');
        return callback(null);
    }

    cp.exec('git status --porcelain', function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }

        if (stdout === '') {
            return callback(new Error('No changed files in git repo'));
        }

        var toPush = [];

        var lines = stdout.split('\n');
        for (var l in lines) {
            var line = lines[l].replace(/^\s+/, '');
            var fields = line.split(/\s+/);
            var type = fields[0];
            var file = fields[1];
            debug('git file: type="%s", file="%s" (line="%s")',
                type, file, line);
            if (type != 'M') {
                continue;
            }

            toPush.push(file);
        }

        state.toPushRaw = toPush;
        return callback(null);
    });
}


/*
 * Checks that passed-in paths exist, and converts them to relative paths
 */
function resolveLocalPaths(state, callback) {
    debug('==> resolveLocalPaths start');

    vasync.forEachParallel({
        inputs: state.toPushRaw,
        func: function (f, cb) {
            fs.stat(f, function _afterStat(err, stat) {
                if (err) {
                    return cb(err);
                }

                var file = path.relative(state.top, f);
                debug('Adding local path "%s"', file);
                state.toPush.push({ path: file, isDir: stat.isDirectory() });
                return cb(null);
            });
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        return callback(null);
    });
}


/*
 * Determine what needs to be done to satisfy each path (what variables
 * are needed, what functions need to be called)
 */
function determineVariableWork(state, callback) {
    debug('==> determineVariableWork start');

    var repo = state.repos[state.repo];
    var errors = [];
    var paths = [];

    for (var p in repo.paths) {
        var fields = repo.paths[p].split('=');
        // TODO: support multiple paths separated by a comma
        var pathObj = {
            local: path.relative(state.top, path.join(state.top, fields[0])),
            remote: fields[1],
            vars: findVars(fields[1]),
            funcs: []
        };

        if (!pathObj.local) {
            pathObj.local = '.';
        }
        pathObj.re = new RegExp('^' + pathObj.local);

        debug('path: [%s=%s]: local="%s", remote="%s", vars="%j"', fields[0],
            fields[1], pathObj.local, pathObj.remote, pathObj.vars);

        var seenVars = {};

        function processVar(pVar, origVar) {
            if (seenVars.hasOwnProperty(pVar)) {
                debug('  processVar: seen "%s", returning', pVar);
                return;
            }
            debug('  processVar: "%s"', pVar);

            state.varValues[pVar] = repo.variables[pVar];
            seenVars[pVar] = 1;

            var func = funcRE.exec(pVar);
            if (func) {
                var params = func[1].split(/\s+/g);
                debug('    function: "%s": args=%j', params[0],
                    params.slice(1));
                if (!hooks.hasOwnProperty(params[0])) {
                    debug('    function "%s" not found, returning', params[0]);
                    errors.push(new VError('Unknown variable "%s"', params[0]));
                    return;
                }

                var funcObj = {
                    func: params[0],
                    args: params.slice(1),
                    varName: origVar ? origVar : pVar
                };
                debug('    function "%s": args=%j, varName=%s',
                    funcObj.func, funcObj.args, funcObj.varName);
                pathObj.funcs.unshift(funcObj);

                return true;
            }

            if (!repo.variables.hasOwnProperty(pVar)) {
                debug('    variable "%s" not found, returning', pVar);
                errors.push(new VError('Unknown variable "%s"', pVar));
                return;
            }

            debug('    variable "%s" found', pVar);
            return true;
        }

        for (var v in pathObj.vars) {
            var vName = pathObj.vars[v];
            debug('path "%s": var="%s"', fields[0], vName);
            if (!processVar(vName)) {
                continue;
            }

            var otherVars = findVars(repo.variables[vName]);
            if (otherVars.length === 0) {
                state.varValues[vName] = vName;
            }

            while (otherVars.length !== 0) {
                var oVar = otherVars.shift();
                debug('other var="%s"', oVar);
                if (!processVar(oVar, vName)) {
                    continue;
                }

                pathObj.vars.unshift(oVar);
                var varVars = findVars(repo.variables[oVar]);
                if (varVars.length === 0) {
                    state.varValues[oVar] = oVar;
                }

                debug('  varVars=%j', varVars);
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
    debug('==> callFunctions start');

    var errors = [];
    var matchingPaths = [];

    for (var lp in state.toPush) {
        var localPath = state.toPush[lp];
        var matchingPath = null;
        debug('  local path: %s', localPath.path);

        for (var rp in state.remotePaths) {
            var remotePath = state.remotePaths[rp];
            if (remotePath.re.test(localPath.path)) {
                debug('    MATCHED: remote path "%s" (%s)', remotePath.local,
                    remotePath.re.toString());
                matchingPath = remotePath;
                break;
            }

            debug('    tried:   remote path "%s" (%s)', remotePath.local,
                remotePath.re.toString());
        }

        if (!matchingPath) {
            errors.push(new VError(
                'No config file paths matched for "%s"', localPath.path));
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
        inputs: matchingPaths,
        func: function (curFunc, cb) {
            var funcName = curFunc.func;
            var funcVarName = fmt('[%s%s%s]',
                funcName,
                curFunc.args.length != 0 ? ' ' : '',
                curFunc.args.join(' '));

            if (state.funcValues.hasOwnProperty(funcVarName)) {
                debug('func "%s" (args=%j): already ran, returing',
                    funcName, curFunc.args);
                return cb(null);
            }

            function hookHandler(e, r) {
                if (e) {
                    return cb(new VError('Function "%s" failed: %s',
                        funcName, e.message));
                }
                debug('function "%s" (args=%j) returned "%s"',
                    funcName, curFunc.args, r);

                state.funcValues[funcVarName] = r;
                state.varValues[funcVarName] = r;

                return cb(null);
            }

            hooks[funcName].apply(this,
                [state].concat(curFunc.args).concat(hookHandler));
        }
    }, function (err) {
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
    debug('==> expandVariables start');
    for (var lp in state.toPush) {
        var e;
        var localPath = state.toPush[lp];
        var remotePath = localPath.matchingPath;
        var toExpand;

        for (var v in remotePath.vars) {
            var varName = remotePath.vars[v];
            debug('  var="%s"', varName);

            toExpand = findVars(state.varValues[varName]);
            for (e in toExpand) {
                var expName = toExpand[e];
                debug('    toExpand: "%s": "%s"',
                    expName, state.varValues[varName]);
                debug('    "%s"=>"%s"', fmt('%%%s%', expName),
                    state.varValues[expName]);
                state.varValues[varName] = state.varValues[varName].replace(
                    fmt('%%%s%', expName), state.varValues[expName]);
            }
        }

        toExpand = findVars(remotePath.remote);
        for (e in toExpand) {
            remotePath.remote = remotePath.remote.replace(
                fmt('%%%s%', toExpand[e]), state.varValues[toExpand[e]]);
        }

        if (remotePath.remote.indexOf('%') !== -1) {
            return callback(new VError('Found %%: "%s" => "%s"',
                localPath.path, remotePath.remote));
        }

        // Trim off the redundant portion of the local path, eg: if local
        // src/foo maps to /usr/src/bar, trim the local portion from
        // src/foo/blah.js
        var trimmedRemote = localPath.path;
        if (remotePath.local !== '.') {
            var trimRE = new RegExp('^' + remotePath.local);
            trimmedRemote = localPath.path.replace(trimRE, '');
            if (trimmedRemote.indexOf('/') === 0) {
                trimmedRemote = trimmedRemote.substr(1);
            }
        }

        // If it's a directory, we want to copy it to the parent
        var remote = fmt('%s/%s', remotePath.remote, trimmedRemote);
        if (localPath.isDir) {
            remote = remote.substr(0, remote.lastIndexOf('/'));
        }

        debug('  remote=%s, trimmed=%s, localPath=%j, remotePath=%j',
            remote, trimmedRemote, localPath, remotePath);

        var scpCmd = fmt('scp %s%s/%s %s:%s',
            localPath.isDir ? '-r ' : '',
            state.top,
            localPath.path,
            state.toHost,
            remote
        );

        debug('  scp command: %s', scpCmd);
        state.scpCommands.push(scpCmd);
    }

    return callback(null);
}


/*
 * scp the files to the host
 */
function runScpCommands(state, callback) {
    debug('==> runScpCommands start');

    vasync.forEachParallel({
        inputs: state.scpCommands,
        func: function _runScp(cmd, cb) {
            if (DRYRUN) {
                console.log('# %s', cmd);
                return cb(null);
            }

            verbose('# %s', cmd);
            cp.exec(cmd, function (err, stdout, stderr) {
                if (err) {
                    return cb(err);
                }

                return cb(null);
            });
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        return callback(null);
    });
}



// --- Entry functions



/*
 * Sets the hostname and username to push to
 */
function setHost(host) {
    var config = { defaultHost: host };
    debug('Writing config to "%s": %j', CONFIG, config);
    fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
}


/*
 * Prints username@hostname
 */
function getHost(host) {
    var state = {};
    loadConfig(state, function (err) {
        if (err) {
            return printErr(err.message);
        }

        console.log(state.config.defaultHost);
    });
}


/*
 * Prints out the current repo (that will be used by pushit for its id)
 */
function printRepo() {
    var state = {};

    getGitRepoRemote(state, function (err, res) {
        if (err) {
            return printErr(err.message);
        }

        return console.log(state.repo);
    });
}


/*
 * Pushes the specified files to the configured server
 */
function push(opts, args) {
    var state = {
        pushAll: opts.all,
        toPushRaw: args,
        toPush: [],
        toHost: opts.host,
        varValues: {},
        funcValues: {},
        scpCommands: []
    };

    vasync.pipeline({
        arg: state,
        funcs: [
            getGitRepoRemote,
            loadConfig,
            setToHost,
            loadRepos,
            validateRemoteRepo,
            getGitTop,
            getAllFromGit,
            resolveLocalPaths,
            determineVariableWork,
            callFunctions,
            expandVariables,
            runScpCommands
        ]
    }, function (err, res) {
        debug(util.inspect(state));

        if (err) {
            var errs = err.hasOwnProperty('ase_errors') ? err.ase_errors :
                [err];
            errs.forEach(function (e) {
                printErr(e.message);
            });
            return;
        }

        if (!DRYRUN) {
            verbose(okStr('Push completed successfully.'));
        }
    });
}


/*
 * Main entry point
 */
function main() {
    var opts;
    var parser = dashdash.createParser({ options: OPTS });

    try {
        opts = parser.parse(process.argv);
    } catch (parseErr) {
        printErr(parseErr.message);
        process.exit(1);
    }

    if (opts.help) {
        return usage(parser);
    }

    if (opts.verbose) {
        common.setVerbose(true);
    }

    if (opts.debug) {
        common.setDebug(true);
    }

    if (opts.dryrun) {
        DRYRUN = true;
    }

    debug('opts: %j', opts);

    if (opts.hasOwnProperty('default')) {
        return setHost(opts.default);
    }

    if (opts.hasOwnProperty('show_default')) {
        return getHost();
    }

    if (opts.hasOwnProperty('repo')) {
        return printRepo();
    }

    // Must run with -a or file args to actually push
    if (!opts.all && opts._args.length === 0) {
        return usage(parser);
    }

    push(opts, opts._args);
}


main();
