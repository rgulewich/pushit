# Pushit

Pushit scp's files to a remote host, and picks where to copy them based on
the current git repo.  The motivation is based on my day to day development
workflow:

* I like to work on my laptop, but
* I have one or more remote test machines that I test things on.
* I'm often working in several git repos at the same time, and
* the code in those repos is deployed in different locations on those test
  machines.
* In addition, the code layout of my local repo often isn't the same as the
  layout on the remote machines, and
* the location of those files on the remote machine might change due to
  running conditions on that machine.

Pushit is meant to make it easy to copy files to remote machines, and to
*not have to worry about where those files end up on the remote machine.*
That means:

* Easily copy files from my working git repos to one or many machines.
* Make the destination location depend on the current git repo (eg:
  `repo1.git` files may go to `/opt/service1` on the remote server, and
  `repo2.git` files may go to `/opt/service2`)
* Allow file locations that may change on the remote machine to be discovered
  by ssh'ing to the machine and running commands.
* Allow file paths to be different between the local git repo and the remote
  machine (eg: `./src/` may actually be `/opt/service1/lib/` on the remote
  machine)

So: pushit.  [Push it real good](https://www.youtube.com/watch?v=vCadcBR95oU).


## Get up on this

Push files to a host:

    cd myrepo
    pushit --host root@myhost myfile1.js myfile2.js

Push all git modified files to a host:

    cd myrepo
    pushit --host root@myhost -a

(The files pushed would be the ones that show up as "modified" in
`git status`.)

Or set a default host and push to it:

    pushit --default root@myhost
    cd myrepo
    pushit -a
    pushit myfile.js myotherfile.js

Now all invocations will scp to `root@myhost`, unless you use `--host` to
override it:

    # scp to root@otherhost, but don't change the default host
    pushit --host root@otherhost myfile.js

Print the default host with:

    pushit --show-default

Note that where the files are copied to is based on what git repo you're
currently in:

    cd myrepo
    pushit -a   # copies to /opt/somedir on the remote host
    cd ../myotherrepo
    pushit -a   # copies to /opt/anotherdir on the remote host

These mappings are set in `~/.pushit-repos` - see the section on .pushit-repos
below for more information on its format.


## Config files

There are two config files for pushit:

* `$HOME/.pushit-repos` stores mappings of git repos to locations on the
  remote host to copy the files.
* `$HOME/.pushitrc` stores the default host information


## .pushit-repos format

The format of `.pushit-repos` is a JSON object.  Each key in the object
is a repo as returned by `git remote -v`.  These repos map to another object
that can have two keys: `paths` and `variables`.

Here is an example config for working on [SmartOS](http://smartos.org/).
There are two repos here:

* [smartos-live.git](https://github.com/joyent/smartos-live) contains files
  in the Global Zone of the SmartOS host
* `sdc-fwapi.git` contains files in the `fwapi` zone of the SmartOS host

```json
{
    "git@github.com:joyent/smartos-live.git": {
        "paths": [
            "./overlay/generic=/",
            "./src/fw/etc=/usr/fw/etc",
            "./src/fw/lib=/usr/fw/lib",
            "./src/fw/node_modules=/usr/fw/node_modules",
            "./src/fw/sbin=/usr/fw/sbin",
            "./src/fw/test=/usr/fw/test",
            "./src/vm/lib=/usr/vm/lib",
            "./src/vm/node_modules=/usr/vm/node_modules",
            "./src/vm/tests=/usr/vm/test/tests",
            "./src/vm/common=/usr/vm/test/common",
            "./src/vm/sbin/vmadm.js=/usr/vm/sbin"
        ]
    },

    "git@github.com:joyent/sdc-fwapi.git": {
        "paths": [
            ".=%prefix%"
        ],
        "variables": {
          "prefix": "%zoneroot%/opt/smartdc/fwapi",
          "zoneroot": "%[smartosZoneAliasToRoot fwapi]%/root"
        }
    }
}
```

**The smartos-live repo:**

The `smartos-live` repo doesn't do anything fancy: it copies files to remote
directories based on their path in the current git repo.  The local paths are
relative to the smartos-live repo.  Some examples from the above config:

* Files in `./src/fw/lib` will be copied to `/usr/fw/lib`
* Files in `./src/vm/common` will be copied to `/usr/vm/test/common`
* Files in `./overlay/generic` will be copied to `/`

Take this example change in
[smartos-live.git](https://github.com/joyent/smartos-live):

    $ git remote -v
    origin  git@github.com:joyent/smartos-live.git (fetch)
    origin  git@github.com:joyent/smartos-live.git (push)
    $ git status -s
     M overlay/generic/usr/lib/brand/jcommon/statechange
     M src/fw/lib/fw.js
     M src/fw/lib/ipf.js
     M src/fw/package.json
     M src/vm/common/vmtest.js
    $ pushit -a

Running `pushit -a` copies the following files:

* `overlay/generic/usr/lib/brand/jcommon/statechange` in the local repo to `/usr/lib/brand/jcommon/statechange` on the remote host
* `src/fw/lib/fw.js` in the local repo to `/usr/fw/lib/fw.js` on the remote host
* `src/fw/lib/ipf.js` in the local repo to `/usr/fw/lib/ipf.js` on the remote host
* `src/vm/common/vmtest.js` in the local repo to /usr/vm/test/vmtest.js` on the remote host

**The sdc-fwapi repo:**

The files in the `sdc-fwapi` repo all get deployed to a
[SmartOS](http://smartos.org/) zone with the
alias `fwapi`.  The files all live in `/opt/smartdc/fwapi` in that zone. In
the above config, those requirements are specified using the *"variables"*
section of the config.  It includes the `smartosZoneAliasToRoot` hook that
sshes to the host to find the zone root for the zone with the **fwapi** alias.

Take this example change in `sdc-fwapi.git`:

    $ git status -s
     M lib/app.js
     M test/lib/cn.js
    $ pushit -a

Running `pushit -a` does the following:

* sshes to the host and gets the zone root of the *fwapi* zone (courtesy of
  the `smartosZoneAliasToRoot` hook): it is found to be
  `/zones/bbf0a657-2fc1-449a-8edf-c7d3daf35953`.
* The *zoneroot* variable is evaluated to be
  `/zones/bbf0a657-2fc1-449a-8edf-c7d3daf35953/root`.
* The *prefix* variable is evaluated to be
  `/zones/bbf0a657-2fc1-449a-8edf-c7d3daf35953/root/opt/smartdc/fwapi`.
* `lib/app.js` in the local repo is copied to
  `/zones/bbf0a657-2fc1-449a-8edf-c7d3daf35953/root/opt/smartdc/fwapi/lib/app.js`
* `test/lib/cn.js` in the local repo is copied to
  `/zones/bbf0a657-2fc1-449a-8edf-c7d3daf35953/root/opt/smartdc/fwapi/test/lib/cn.js`


### paths

`paths` is an array of strings of the format:

    localpath=remotepath

This maps local paths relative to the git repo to remote paths on the
server.  For example, the `smartos-live` repo in the JSON above contains
`"./src/fw/sbin=/usr/fw/sbin"`, which means files in
[smartos-live.git/src/fw/sbin](https://github.com/joyent/smartos-live/tree/master/src/fw/sbin)
will be copied to `/usr/fw/sbin` on the remote machine.

### variables

`variables` is an object mapping variable names to their values.  These
variables can be used in the `paths` array as well as in other variable
values.  The variables are expanded when you run `pushit` in a repo.  There
are two types:

* Plain variables: `%variablename%` (like `%prefix%` in the example JSON).
  These must be one of the keys in the `variables` object, and are expanded
  at runtime.
* Hooks: `%[hookname arguments]` (like `%[smartosZoneAliasToRoot fwapi]% in
  the example JSON - `smartosZoneAliasToRoot` is the hook name, and `fwapi`
  is the argument).  These are functions in lib/hooks.js that can be used
  to fill in part of a variable.

### hooks

There is currently only one hook: `smartosZoneAliasToRoot`

**smartosZoneAliasToRoot**

* Argument: zone alias
* Returns: path to the zone's root

This sshes to a SmartOS host and looks up a zone by the alias.


## .pushitrc format

Currently the only thing you can set is `defaultHost`, which is set by
`pushit --default myhost`.  The format of the default host is anything that's
acceptable by ssh or scp.  This is valid:

```json
{
  "defaultHost": "headnode"
}
```

As is this:

```json
{
  "defaultHost": "root@10.99.99.7"
}
```

## Current Status

Works for me.  The code was written hastily, so there are rough edges and
probably bugs.

## License

MIT.  See "LICENSE.txt".
