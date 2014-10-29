/*
 * pushit push hooks
 *
 * Right now, only contains functions that are run in variable expansion
 */


var common = require('./common');
var cp = require('child_process');
var util = require('util');
var debug = common.debug;
var verbose = common.verbose;


/*
 * Runs an ssh command on the remote host
 */
function ssh(state, cmd, callback) {
    var sshCmd = util.format('ssh %s \'%s\'', state.toHost, cmd);

    verbose('# %s', sshCmd);
    cp.exec(sshCmd, function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }

        return callback(null, { stdout: stdout, stderr: stderr });
    });
}


/*
 * Gets the zone root based on its alias
 */
function getZoneRoot(state, zoneAlias, callback) {
    debug('====> getZoneRoot start');
    var cmd = util.format(
        'vmadm get $(vmadm lookup -1 tags.smartdc_role=~^%s) | '
        + 'json zonepath', zoneAlias);

    ssh(state, cmd, function _afterVmadm(err, res) {
        if (err) {
            return callback(err);
        }

        var stdout = res.stdout.replace('\n', '');
        verbose('  %s', stdout);

        // TODO: truncate stdout to one line before returning
        return callback(null, stdout);
    });
}



module.exports = {
    getZoneRoot: getZoneRoot,
    debug: debug
};
