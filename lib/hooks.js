/*
 * pushit push hooks
 *
 * Right now, only contains functions that are run in variable expansion
 */


var child_process = require('child_process');
var util = require('util');

var common = require('./common');
var debug = common.debug;
var verbose = common.verbose;


/*
 * Runs an ssh command on the remote host
 */
function ssh(state, cmd, callback) {
  var cmd = util.format("ssh %s@%s '%s'",
      state.config.username, state.config.hostname, cmd);
  verbose("# %s", cmd);
  child_process.exec(cmd, function (err, stdout, stderr) {
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
  debug("====> getZoneRoot start");
  var cmd = util.format(
      "vmadm get $(vmadm lookup -1 alias=%s0) | json zonepath", zoneAlias);
  ssh(state, cmd, function(err, res) {
    if (err) {
      return callback(err);
    }
    var stdout = res.stdout.replace("\n", "");
    verbose("  %s", stdout);

    return callback(null, stdout);
  });
}



module.exports = {
  getZoneRoot: getZoneRoot,
  debug: debug
}
