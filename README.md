# Pushit

[Push it real good](https://www.youtube.com/watch?v=vCadcBR95oU). Pushit
copies files to a remote host using `scp(1)`, and picks where to copy them
based on the git remote repo.

## Get up on this

Push files to a host:

    cd myrepo
    pushit --host root@myhost myfile1.js myfile2.js

Push all modified files (according to git) to a host:

    cd myrepo
    pushit --host root@myhost -a

The files pushed would be the ones that show up as "modified" in
`git status`.

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

* `$HOME/.pushitrc` stores the default host information
* `$HOME/.pushit-repos` stores mappings of git repos to locations on the
  remote host to copy the files.

### .pushitrc format

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

### .pushit-repos format

Here is an example config for working on SmartOS.  There are two repos here:

* `smartos-live.git` maps to files in the Global Zone of the SmartOS host
* `sdc-vmapi.git` maps to files in the `vmapi` zone

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

**smartos-live:**

The `smartos-live` repo doesn't do anything fancy: it copies files to remote
directories based on their path in the current git repo.  The local paths are
relative to the smartos-live repo.  Some examples from the above config:

* Files in `./src/fw/lib` will be copied to `/usr/fw/lib`
* Files in `./src/vm/common` will be copied to `/usr/vm/test/common`
* Files in `./overlay/generic` will be copied to `/`

Take this example change in `smartos-live.git`:

```bash
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
```

Running `pushit -a` copies the following files:

* `overlay/generic/usr/lib/brand/jcommon/statechange` in the local repo to `/usr/lib/brand/jcommon/statechange` on the remote host
* `src/fw/lib/fw.js` in the local repo to `/usr/fw/lib/fw.js` on the remote host
* `src/fw/lib/ipf.js` in the local repo to `/usr/fw/lib/ipf.js` on the remote host
* `src/vm/common/vmtest.js` in the local repo to /usr/vm/test/vmtest.js` on the remote host

**sdc-fwapi:**

The files in the `sdc-fwapi` repo all get deployed to a SmartOS zone with the
alias `fwapi`.  The files all live in `/opt/smartdc/fwapi` in that zone. In
the above config, those requirements are specified using the *"variables"*
section of the config.  It includes the `smartosZoneAliasToRoot` hook that
sshes to the host to find the zone root for the zone with the *fwapi* alias.

Take this example change in `sdc-fwapi.git`:

```bash
$ git status -s
 M lib/app.js
 M test/lib/cn.js
$ pushit -a
```

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
