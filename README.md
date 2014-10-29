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

