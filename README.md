# Pushit

[Push it real good](https://www.youtube.com/watch?v=vCadcBR95oU). Pushit
copies files to a remote host using `scp(1)`, and picks where to copy them
based on the git remote repo.

## Get up on this

Push to a host:

    pushit --host root@myhost myfile.js

Push all files to a host:

    pushit --host root@myhost -a

Or set a default host and push to it:

    pushit --default root@myhost
    pushit -a
    pushit myfile.js myotherfile.js

Now all invocations will scp to `root@myhost`, unless you use `--host` to
override it:

    # scp to root@otherhost, but don't change the default host
    pushit --host root@otherhost myfile.js

Print the default host with:

    pushit --show-default

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
