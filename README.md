# Push It

Push it real good. pushit pushes files to a remote server, based on:

* the git remote of whatever repo you're in
* the current host (set with `pushit --host username@hostname`
* the repo config file ($HOME/.pushit-repos)


## TODO

- Cache variable expansion function returns (eg: so that we don't have to
  figure out a zonename every time), and retry only when the scp fails
- Pre-copy hooks (eg: make sure an fs is mounted)
- Post-copy hooks (eg: restart a service)
- Document repo format
- Make repo format suck less
